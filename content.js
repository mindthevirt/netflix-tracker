chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'checkActiveWatching') {
      const activeWatching = checkActiveWatching();
      sendResponse({ activeWatching: activeWatching });
    }
  });
  
  function checkActiveWatching() {
    const videoElement = document.querySelector('video');
    if (videoElement) {
      return !videoElement.paused;
    }
    return false;
  }