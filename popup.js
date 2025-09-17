class PomodoroUI {
  constructor() {
    this.focusTimeInput = document.getElementById('focusTime');
    this.breakTimeInput = document.getElementById('breakTime');
    this.startBtn = document.getElementById('startBtn');
    this.startBreakBtn = document.getElementById('startBreakBtn');
    this.resetBtn = document.getElementById('resetBtn');
    this.settingsBtn = document.getElementById('settingsBtn');
    this.timerDisplay = document.getElementById('timerDisplay');
    this.status = document.getElementById('status');
    this.confirmDialog = document.getElementById('confirmDialog');
    this.confirmResetBtn = document.getElementById('confirmReset');
    this.cancelResetBtn = document.getElementById('cancelReset');
    this.todayFocus = document.getElementById('todayFocus');
    this.todaySessions = document.getElementById('todaySessions');
    
    this.initializeEventListeners();
    this.loadSettings();
    this.updateUI();
    this.updateStats();
  }

  initializeEventListeners() {
    // Plus/minus buttons
    document.querySelectorAll('.plus-btn, .minus-btn').forEach(btn => {
      btn.addEventListener('click', this.handleNumberInput.bind(this));
    });

    // Start button
    this.startBtn.addEventListener('click', this.handleStart.bind(this));
    
    // Start break button
    this.startBreakBtn.addEventListener('click', this.handleStartBreak.bind(this));

    // Reset button and dialog
    this.resetBtn.addEventListener('click', this.showResetDialog.bind(this));
    this.confirmResetBtn.addEventListener('click', this.handleReset.bind(this));
    this.cancelResetBtn.addEventListener('click', this.hideResetDialog.bind(this));
    
    // Settings button
    this.settingsBtn.addEventListener('click', this.openSettings.bind(this));
    
    // Close dialog when clicking overlay
    this.confirmDialog.addEventListener('click', (e) => {
      if (e.target === this.confirmDialog) {
        this.hideResetDialog();
      }
    });

    // Listen for timer updates from background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'TIMER_UPDATE') {
        this.updateTimerDisplay(message.timeLeft, message.phase);
      } else if (message.type === 'TIMER_RESET') {
        this.handleResetComplete();
      } else if (message.type === 'STATS_UPDATE') {
        this.updateStats();
      }
    });
  }

  openSettings() {
    chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
  }

  async updateStats() {
    const today = new Date().toDateString();
    const result = await chrome.storage.local.get(['pomodoroLogs']);
    const logs = result.pomodoroLogs || [];
    
    const todayLogs = logs.filter(log => new Date(log.timestamp).toDateString() === today);
    
    let totalFocusMinutes = 0;
    let sessionCount = 0;
    
    todayLogs.forEach(log => {
      if (log.event === 'focus_end') {
        const startLog = todayLogs.find(l => 
          l.event === 'focus_start' && 
          l.sessionId === log.sessionId
        );
        if (startLog) {
          const duration = (new Date(log.timestamp) - new Date(startLog.timestamp)) / (1000 * 60);
          totalFocusMinutes += Math.round(duration);
          sessionCount++;
        }
      }
    });
    
    this.todayFocus.textContent = `${Math.floor(totalFocusMinutes / 60)}h ${totalFocusMinutes % 60}m`;
    this.todaySessions.textContent = sessionCount;
  }

  handleNumberInput(e) {
    const targetId = e.target.dataset.target;
    const input = document.getElementById(targetId);
    const isPlus = e.target.classList.contains('plus-btn');
    
    let currentValue = parseInt(input.value);
    const min = parseInt(input.min);
    const max = parseInt(input.max);
    
    if (isPlus && currentValue < max) {
      input.value = currentValue + 1;
    } else if (!isPlus && currentValue > min) {
      input.value = currentValue - 1;
    }
    
    this.saveSettings();
  }

  async handleStart() {
    const focusTime = parseInt(this.focusTimeInput.value);
    const breakTime = parseInt(this.breakTimeInput.value);
    
    chrome.runtime.sendMessage({
      type: 'START_FOCUS',
      focusTime,
      breakTime
    });
    
    this.updateUI();
  }

  async handleStartBreak() {
    chrome.runtime.sendMessage({
      type: 'START_BREAK'
    });
    
    this.updateUI();
  }

  showResetDialog() {
    this.confirmDialog.style.display = 'flex';
  }

  hideResetDialog() {
    this.confirmDialog.style.display = 'none';
  }

  handleReset() {
    chrome.runtime.sendMessage({
      type: 'RESET_TIMER'
    });
    
    this.hideResetDialog();
  }

  handleResetComplete() {
    this.timerDisplay.textContent = '00:00';
    this.status.textContent = 'Ready to focus';
    this.status.className = 'status';
    this.startBtn.style.display = 'block';
    this.startBtn.textContent = 'Start';
    this.startBtn.disabled = false;
    this.startBreakBtn.style.display = 'none';
  }

  updateTimerDisplay(timeLeft, phase) {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    this.timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    this.startBtn.style.display = 'block';
    this.startBreakBtn.style.display = 'none';
    
    if (phase === 'focus') {
      this.status.textContent = 'Focus time - stay concentrated!';
      this.status.className = 'status running';
      this.startBtn.textContent = 'Running...';
      this.startBtn.disabled = true;
    } else if (phase === 'break') {
      this.status.textContent = 'Break time - relax and recharge!';
      this.status.className = 'status running';
      this.startBtn.textContent = 'Running...';
      this.startBtn.disabled = true;
    } else if (phase === 'focus_ended') {
      this.status.textContent = 'Focus time has ended. It\'s time to take a break.';
      this.status.className = 'status';
      this.startBtn.style.display = 'none';
      this.startBreakBtn.style.display = 'block';
    } else if (phase === 'break_ended') {
      this.status.textContent = 'Break is over. Ready for another focus session?';
      this.status.className = 'status';
      this.startBtn.textContent = 'Start';
      this.startBtn.disabled = false;
      this.startBreakBtn.style.display = 'none';
    } else {
      this.status.textContent = 'Ready to focus';
      this.status.className = 'status';
      this.startBtn.textContent = 'Start';
      this.startBtn.disabled = false;
      this.startBreakBtn.style.display = 'none';
    }
  }

  async updateUI() {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
      if (response) {
        const { isRunning, phase, timeLeft } = response;
        this.updateTimerDisplay(timeLeft, phase);
      }
    });
  }

  saveSettings() {
    const settings = {
      focusTime: parseInt(this.focusTimeInput.value),
      breakTime: parseInt(this.breakTimeInput.value)
    };
    chrome.storage.local.set(settings);
  }

  loadSettings() {
    chrome.storage.local.get(['focusTime', 'breakTime'], (result) => {
      if (result.focusTime) {
        this.focusTimeInput.value = result.focusTime;
      }
      if (result.breakTime) {
        this.breakTimeInput.value = result.breakTime;
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new PomodoroUI();
});
