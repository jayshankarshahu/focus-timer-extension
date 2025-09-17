class SettingsManager {
  constructor() {
    this.currentWeekOffset = 0;
    this.chart = null;
    this.initializeEventListeners();
    this.loadSettings();
    this.setupChart();
  }

  initializeEventListeners() {
    // Close button
    document.getElementById('closeSettings').addEventListener('click', () => {
      window.close();
    });

    // Master sound toggle
    document.getElementById('masterSoundToggle').addEventListener('change', this.handleMasterToggle.bind(this));

    // Individual sound toggles and file uploads
    ['focusStart', 'focusEnd', 'breakStart', 'breakEnd'].forEach(sound => {
      document.getElementById(`${sound}Toggle`).addEventListener('change', this.handleSoundToggle.bind(this, sound));
      document.getElementById(`${sound}Sound`).addEventListener('change', this.handleSoundUpload.bind(this, sound));
      document.querySelector(`[data-sound="${sound}"]`).addEventListener('click', this.testSound.bind(this, sound));
    });

    // Week navigation
    document.getElementById('prevWeek').addEventListener('click', () => {
      this.currentWeekOffset--;
      this.updateChart();
    });

    document.getElementById('nextWeek').addEventListener('click', () => {
      this.currentWeekOffset++;
      this.updateChart();
    });
  }

  async loadSettings() {
    const result = await chrome.storage.local.get([
      'soundSettings',
      'masterSoundEnabled',
      'customSounds'
    ]);

    const soundSettings = result.soundSettings || {};
    const masterEnabled = result.masterSoundEnabled !== false;
    const customSounds = result.customSounds || {};

    document.getElementById('masterSoundToggle').checked = masterEnabled;

    ['focusStart', 'focusEnd', 'breakStart', 'breakEnd'].forEach(sound => {
      const toggle = document.getElementById(`${sound}Toggle`);
      
      toggle.checked = soundSettings[`${sound}Enabled`] !== false;
      
      // Update label text and test button visibility based on whether file exists
      this.updateLabelText(sound, !!customSounds[sound]);
    });
  }

  updateLabelText(soundType, hasFile) {
    const label = document.getElementById(`${soundType}Label`);
    const testBtn = document.querySelector(`[data-sound="${soundType}"]`);
    
    if (hasFile) {
      label.textContent = 'Audio is Already set, Click to choose a new Audio';
      label.classList.add('has-file');
      if (testBtn) testBtn.style.display = 'inline-block';
    } else {
      label.textContent = 'Click to choose a new Audio';
      label.classList.remove('has-file');
      if (testBtn) testBtn.style.display = 'none';
    }
  }

  async handleMasterToggle(event) {
    const enabled = event.target.checked;
    await chrome.storage.local.set({ masterSoundEnabled: enabled });
  }

  async handleSoundToggle(soundType, event) {
    const enabled = event.target.checked;
    const result = await chrome.storage.local.get(['soundSettings']);
    const soundSettings = result.soundSettings || {};
    soundSettings[`${soundType}Enabled`] = enabled;
    await chrome.storage.local.set({ soundSettings });
  }

  async handleSoundUpload(soundType, event) {
    const file = event.target.files[0];
    
    if (file && file.type === 'audio/mpeg') {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const result = await chrome.storage.local.get(['customSounds']);
        const customSounds = result.customSounds || {};
        
        customSounds[soundType] = e.target.result;
        await chrome.storage.local.set({ customSounds });
        
        // Update label text and show test button
        this.updateLabelText(soundType, true);
      };
      reader.readAsDataURL(file);
    } else if (file) {
      alert('Please select an MP3 file.');
      event.target.value = ''; // Clear invalid selection
    }
  }

  async testSound(soundType) {
    const result = await chrome.storage.local.get(['customSounds', 'soundSettings', 'masterSoundEnabled']);
    const customSounds = result.customSounds || {};
    const soundSettings = result.soundSettings || {};
    const masterEnabled = result.masterSoundEnabled !== false;

    if (!masterEnabled || soundSettings[`${soundType}Enabled`] === false) {
      return;
    }

    const soundData = customSounds[soundType];
    if (soundData) {
      const audio = new Audio(soundData);
      audio.volume = 0.5;
      audio.play().catch(console.error);
    } else {
      alert('No sound file uploaded for this event.');
    }
  }

  // Chart methods remain the same...
  async setupChart() {
    const ctx = document.getElementById('analyticsChart').getContext('2d');
    
    this.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{
          label: 'Focus Time (minutes)',
          data: [],
          backgroundColor: '#44ff44',
          borderColor: '#ffffff',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            labels: {
              color: '#ffffff'
            }
          }
        },
        scales: {
          x: {
            ticks: {
              color: '#ffffff'
            },
            grid: {
              color: '#333333'
            }
          },
          y: {
            ticks: {
              color: '#ffffff'
            },
            grid: {
              color: '#333333'
            }
          }
        }
      }
    });

    this.updateChart();
  }

  async updateChart() {
    const result = await chrome.storage.local.get(['pomodoroLogs']);
    const logs = result.pomodoroLogs || [];

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + (this.currentWeekOffset * 7));
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    document.getElementById('currentWeek').textContent = 
      `${weekStart.toLocaleDateString()} - ${weekEnd.toLocaleDateString()}`;

    const weekData = Array(7).fill(0);
    const dayLabels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    logs.forEach(log => {
      const logDate = new Date(log.timestamp);
      if (logDate >= weekStart && logDate <= weekEnd && log.event === 'focus_end') {
        const startLog = logs.find(l => 
          l.event === 'focus_start' && 
          l.sessionId === log.sessionId
        );
        if (startLog) {
          const duration = (logDate - new Date(startLog.timestamp)) / (1000 * 60);
          const dayIndex = logDate.getDay();
          weekData[dayIndex] += Math.round(duration);
        }
      }
    });

    this.chart.data.labels = dayLabels;
    this.chart.data.datasets[0].data = weekData;
    this.chart.update();

    const totalFocusTime = weekData.reduce((sum, day) => sum + day, 0);
    const totalSessions = logs.filter(log => 
      new Date(log.timestamp) >= weekStart && 
      new Date(log.timestamp) <= weekEnd && 
      log.event === 'focus_end'
    ).length;
    const avgSession = totalSessions > 0 ? Math.round(totalFocusTime / totalSessions) : 0;

    document.getElementById('totalFocusTime').textContent = 
      `${Math.floor(totalFocusTime / 60)}h ${totalFocusTime % 60}m`;
    document.getElementById('totalSessions').textContent = totalSessions;
    document.getElementById('avgSession').textContent = `${avgSession}m`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new SettingsManager();
});
