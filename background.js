class PomodoroBackground {
  constructor() {
    this.state = {
      isRunning: false,
      phase: 'ready',
      timeLeft: 0,
      focusTime: 25,
      breakTime: 5,
      startTime: null,
      sessionId: null
    };
    
    this.offscreenCreating = null;
    this.initializeEventListeners();
    this.loadState();
  }

  generateSessionId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  async logEvent(event, additionalData = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event,
      sessionId: this.state.sessionId,
      ...additionalData
    };

    const result = await chrome.storage.local.get(['pomodoroLogs']);
    const logs = result.pomodoroLogs || [];
    logs.push(logEntry);
    
    if (logs.length > 1000) {
      logs.splice(0, logs.length - 1000);
    }
    
    await chrome.storage.local.set({ pomodoroLogs: logs });
    this.sendMessage('STATS_UPDATE', {});
  }

  async hasOffscreenDocument() {
    if (!chrome.offscreen) return false;
    
    try {
      // Check if hasDocument method exists (Chrome 116+)
      if (chrome.offscreen.hasDocument) {
        return await chrome.offscreen.hasDocument();
      }
      
      // Fallback method for older Chrome versions
      const matchedClients = await clients.matchAll();
      return matchedClients.some(client => 
        client.url === chrome.runtime.getURL('offscreen.html')
      );
    } catch (error) {
      console.error('Error checking offscreen document:', error);
      return false;
    }
  }

  async setupOffscreenDocument() {
    if (!chrome.offscreen) {
      console.warn('Offscreen API not available. Audio will not work.');
      return false;
    }

    try {
      if (this.offscreenCreating) {
        await this.offscreenCreating;
        return true;
      }

      if (await this.hasOffscreenDocument()) {
        return true;
      }

      this.offscreenCreating = chrome.offscreen.createDocument({
        url: chrome.runtime.getURL('offscreen.html'),
        reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
        justification: 'Play timer notification sounds'
      });

      await this.offscreenCreating;
      this.offscreenCreating = null;
      return true;
    } catch (error) {
      console.error('Failed to create offscreen document:', error);
      this.offscreenCreating = null;
      return false;
    }
  }

  async playSound(soundType) {
    const result = await chrome.storage.local.get([
      'customSounds', 
      'soundSettings', 
      'masterSoundEnabled'
    ]);
    
    const customSounds = result.customSounds || {};
    const soundSettings = result.soundSettings || {};
    const masterEnabled = result.masterSoundEnabled !== false;

    if (!masterEnabled || soundSettings[`${soundType}Enabled`] === false) {
      return;
    }

    const soundData = customSounds[soundType];
    if (!soundData) {
      return;
    }

    // Try to setup offscreen document for audio
    const offscreenReady = await this.setupOffscreenDocument();
    
    if (offscreenReady) {
      try {
        chrome.runtime.sendMessage({
          type: 'PLAY_SOUND',
          soundData
        });
      } catch (error) {
        console.error('Failed to send sound message:', error);
      }
    } else {
      console.warn('Cannot play sound: Offscreen document unavailable');
    }
  }

  initializeEventListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.type) {
        case 'START_FOCUS':
          this.startFocus(message.focusTime, message.breakTime);
          break;
        case 'START_BREAK':
          this.startBreak();
          break;
        case 'RESET_TIMER':
          this.resetTimer();
          break;
        case 'GET_STATE':
          sendResponse(this.state);
          break;
      }
    });

    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'pomodoroTick') {
        this.tick();
      }
    });

    chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
      if (notificationId === 'pomodoroNotification' && buttonIndex === 0) {
        if (this.state.phase === 'focus_ended') {
          this.startBreak();
        } else if (this.state.phase === 'break_ended') {
          this.state.phase = 'ready';
          this.state.timeLeft = 0;
          this.saveState();
        }
        chrome.notifications.clear(notificationId);
      }
    });

    chrome.notifications.onClicked.addListener((notificationId) => {
      if (notificationId === 'pomodoroNotification') {
        chrome.action.openPopup();
        chrome.notifications.clear(notificationId);
      }
    });
  }

  async startFocus(focusTime, breakTime) {
    this.state.isRunning = true;
    this.state.phase = 'focus';
    this.state.timeLeft = focusTime * 60;
    this.state.focusTime = focusTime;
    this.state.breakTime = breakTime;
    this.state.startTime = Date.now();
    this.state.sessionId = this.generateSessionId();
    
    await this.logEvent('focus_start', { 
      plannedDuration: focusTime,
      actualStartTime: this.state.startTime 
    });
    
    this.saveState();
    this.startTicker();
    this.playSound('focusStart');
    this.notifyPopup();
  }

  async startBreak() {
    this.state.isRunning = true;
    this.state.phase = 'break';
    this.state.timeLeft = this.state.breakTime * 60;
    this.state.startTime = Date.now();
    
    await this.logEvent('break_start', { 
      plannedDuration: this.state.breakTime,
      actualStartTime: this.state.startTime 
    });
    
    this.saveState();
    this.startTicker();
    this.playSound('breakStart');
    this.notifyPopup();
  }

  async resetTimer() {
    if (this.state.isRunning && this.state.sessionId) {
      await this.logEvent('session_reset', {
        timeRemaining: this.state.timeLeft,
        phase: this.state.phase
      });
    }
    
    this.state.isRunning = false;
    this.state.phase = 'ready';
    this.state.timeLeft = 0;
    this.state.startTime = null;
    this.state.sessionId = null;
    
    this.stopTicker();
    chrome.notifications.clear('pomodoroNotification');
    
    this.saveState();
    this.sendMessage('TIMER_RESET', {});
    this.notifyPopup();
  }

  startTicker() {
    chrome.alarms.clear('pomodoroTick');
    chrome.alarms.create('pomodoroTick', { periodInMinutes: 1/60 });
  }

  stopTicker() {
    chrome.alarms.clear('pomodoroTick');
  }

  tick() {
    if (!this.state.isRunning) return;

    const elapsedSeconds = Math.floor((Date.now() - this.state.startTime) / 1000);
    const originalTime = this.state.phase === 'focus' ? 
      this.state.focusTime * 60 : this.state.breakTime * 60;
    
    this.state.timeLeft = Math.max(0, originalTime - elapsedSeconds);

    if (this.state.timeLeft <= 0) {
      this.timerEnded();
    } else {
      this.notifyPopup();
    }

    this.saveState();
  }

  async timerEnded() {
    this.state.isRunning = false;
    this.stopTicker();

    if (this.state.phase === 'focus') {
      await this.logEvent('focus_end', {
        actualDuration: Math.round((Date.now() - this.state.startTime) / (1000 * 60)),
        plannedDuration: this.state.focusTime
      });
      
      this.state.phase = 'focus_ended';
      this.playSound('focusEnd');
      this.showNotification(
        'Focus time has ended. It\'s time to take a break.',
        'Start Break'
      );
    } else if (this.state.phase === 'break') {
      await this.logEvent('break_end', {
        actualDuration: Math.round((Date.now() - this.state.startTime) / (1000 * 60)),
        plannedDuration: this.state.breakTime
      });
      
      this.state.phase = 'break_ended';
      this.playSound('breakEnd');
      this.showNotification(
        'Break is over. Ready for another focus session?',
        'Got it'
      );
    }

    this.saveState();
    this.notifyPopup();
  }

  async showNotification(message, buttonText) {
    const windows = await chrome.windows.getAll();
    const focusedWindow = windows.find(window => window.focused);
    
    if (focusedWindow) {
      try {
        chrome.action.openPopup();
      } catch (error) {
        this.createNotification(message, buttonText);
      }
    } else {
      this.createNotification(message, buttonText);
    }
  }

  createNotification(message, buttonText) {
    chrome.notifications.create('pomodoroNotification', {
      type: 'basic',
      iconUrl: 'icon.png',
      title: 'Focus Timer',
      message: message,
      buttons: [{ title: buttonText }],
      requireInteraction: true
    });
  }

  sendMessage(type, data) {
    chrome.runtime.sendMessage({ type, ...data }).catch(() => {});
  }

  notifyPopup() {
    this.sendMessage('TIMER_UPDATE', {
      timeLeft: this.state.timeLeft,
      phase: this.state.phase
    });
  }

  saveState() {
    chrome.storage.local.set({ pomodoroState: this.state });
  }

  loadState() {
    chrome.storage.local.get(['pomodoroState'], (result) => {
      if (result.pomodoroState) {
        this.state = { ...this.state, ...result.pomodoroState };
        
        if (this.state.isRunning && this.state.startTime) {
          const elapsedSeconds = Math.floor((Date.now() - this.state.startTime) / 1000);
          const originalTime = this.state.phase === 'focus' ? 
            this.state.focusTime * 60 : this.state.breakTime * 60;
          
          this.state.timeLeft = Math.max(0, originalTime - elapsedSeconds);
          
          if (this.state.timeLeft > 0) {
            this.startTicker();
          } else {
            this.timerEnded();
          }
        }
      }
    });
  }
}

const pomodoroBackground = new PomodoroBackground();
