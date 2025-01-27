console.log('Netflix Tracker content script loaded');

// Function to set up video event listeners
function setupVideoListeners() {
  const videos = document.getElementsByTagName('video');
  for (const video of videos) {
    video.addEventListener('play', () => {
      console.log('Video play event detected');
      chrome.runtime.sendMessage({ action: 'videoStart' });
    });
    video.addEventListener('pause', () => {
      console.log('Video pause event detected');
      chrome.runtime.sendMessage({ action: 'videoStop' });
    });
  }
}

// Observe DOM changes to detect dynamically loaded video elements
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.type === 'childList') {
      setupVideoListeners();
    }
  });
});

observer.observe(document.body, { childList: true, subtree: true });

// Initial setup in case videos are already loaded
setupVideoListeners();