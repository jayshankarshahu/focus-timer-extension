let currentAudio = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PLAY_SOUND' && message.soundData) {
    try {
      // Stop any currently playing audio
      if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
      }

      // Create and play new audio
      currentAudio = new Audio(message.soundData);
      currentAudio.volume = 0.5; // Set reasonable volume
      
      currentAudio.play().then(() => {
        console.log('Sound played successfully');
      }).catch(error => {
        console.error('Error playing sound:', error);
      });

      // Clean up after playback
      currentAudio.addEventListener('ended', () => {
        currentAudio = null;
      });

    } catch (error) {
      console.error('Error in offscreen sound playback:', error);
    }
  }
});

// Keep the offscreen document alive during audio playback
console.log('Offscreen document loaded for audio playback');
