class PomodoroBackground {
  constructor() {
    this.state = {
      isRunning: false,
      phase: 'ready', // ready, focus, break, focus_ended, break_ended
      timeLeft: 0,
      focusTime: 25,
      breakTime: 5,
      startTime: null
    };
    
    this.initializeListeners();
    this.loadState();
  }

  initializeListeners() {
    // Handle messages from popup
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

    // Handle alarm events
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'pomodoroTick') {
        this.tick();
      }
    });

    // Handle notification button clicks
    chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
      if (notificationId === 'pomodoroNotification' && buttonIndex === 0) {
        if (this.state.phase === 'focus_ended') {
          this.startBreak();
        } else if (this.state.phase === 'break_ended') {
          // Reset for new cycle
          this.state.phase = 'ready';
          this.state.timeLeft = 0;
          this.saveState();
        }
        chrome.notifications.clear(notificationId);
      }
    });

    // Handle notification clicks
    chrome.notifications.onClicked.addListener((notificationId) => {
      if (notificationId === 'pomodoroNotification') {
        chrome.action.openPopup();
        chrome.notifications.clear(notificationId);
      }
    });
  }

  startFocus(focusTime, breakTime) {
    this.state.isRunning = true;
    this.state.phase = 'focus';
    this.state.timeLeft = focusTime * 60;
    this.state.focusTime = focusTime;
    this.state.breakTime = breakTime;
    this.state.startTime = Date.now();
    
    this.saveState();
    this.startTicker();
    this.notifyPopup();
  }

  startBreak() {
    this.state.isRunning = true;
    this.state.phase = 'break';
    this.state.timeLeft = this.state.breakTime * 60;
    this.state.startTime = Date.now();
    
    this.saveState();
    this.startTicker();
    this.notifyPopup();
  }

  resetTimer() {
    // Stop any running timer
    this.state.isRunning = false;
    this.state.phase = 'ready';
    this.state.timeLeft = 0;
    this.state.startTime = null;
    
    // Clear any alarms
    this.stopTicker();
    
    // Clear any notifications
    chrome.notifications.clear('pomodoroNotification');
    
    this.saveState();
    
    // Send reset confirmation to popup
    chrome.runtime.sendMessage({
      type: 'TIMER_RESET'
    }).catch(() => {
      // Popup might not be open, ignore error
    });
    
    this.notifyPopup();
  }

  startTicker() {
    chrome.alarms.clear('pomodoroTick');
    chrome.alarms.create('pomodoroTick', { periodInMinutes: 1/60 }); // Every second
  }

  stopTicker() {
    chrome.alarms.clear('pomodoroTick');
  }

  tick() {
    if (!this.state.isRunning) return;

    // Calculate actual time left based on start time to avoid drift
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

  timerEnded() {
    this.state.isRunning = false;
    this.stopTicker();

    if (this.state.phase === 'focus') {
      this.state.phase = 'focus_ended';
      this.showNotification(
        'Focus time has ended. It\'s time to take a break.',
        'Start Break'
      );
    } else if (this.state.phase === 'break') {
      this.state.phase = 'break_ended';
      this.showNotification(
        'Break is over. Ready for another focus session?',
        'Got it'
      );
    }

    this.saveState();
    this.notifyPopup();
  }

  async showNotification(message, buttonText) {
    // Check if browser window is focused
    const windows = await chrome.windows.getAll();
    const focusedWindow = windows.find(window => window.focused);
    
    if (focusedWindow) {
      // Browser is focused, try to open popup
      try {
        chrome.action.openPopup();
      } catch (error) {
        // Fallback to notification if popup can't be opened
        this.createNotification(message, buttonText);
      }
    } else {
      // Browser is not focused, show notification
      this.createNotification(message, buttonText);
    }
  }

  createNotification(message, buttonText) {
    chrome.notifications.create('pomodoroNotification', {
      type: 'basic',
      iconUrl: 'icon.png',
      title: 'Pomodoro Timer',
      message: message,
      buttons: [{ title: buttonText }],
      requireInteraction: true
    });
  }

  notifyPopup() {
    // Send update to popup if it's open
    chrome.runtime.sendMessage({
      type: 'TIMER_UPDATE',
      timeLeft: this.state.timeLeft,
      phase: this.state.phase
    }).catch(() => {
      // Popup is not open, ignore error
    });
  }

  saveState() {
    chrome.storage.local.set({ pomodoroState: this.state });
  }

  loadState() {
    chrome.storage.local.get(['pomodoroState'], (result) => {
      if (result.pomodoroState) {
        this.state = { ...this.state, ...result.pomodoroState };
        
        // Resume timer if it was running
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

// Initialize background script
const pomodoroBackground = new PomodoroBackground();
