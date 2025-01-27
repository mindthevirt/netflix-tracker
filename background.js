let timer;
let isTracking = false;
let netflixTabId = null;
let uniqueIdentifier = null;

// Generate or retrieve a unique identifier
chrome.storage.local.get(['uniqueIdentifier'], (result) => {
  if (!result.uniqueIdentifier) {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      uniqueIdentifier = crypto.randomUUID(); // Use crypto.randomUUID() if available
    } else {
      // Fallback to custom UUID generator
      uniqueIdentifier = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }
    chrome.storage.local.set({ uniqueIdentifier: uniqueIdentifier }, () => {
      console.log('Generated unique identifier:', uniqueIdentifier);
    });
  } else {
    uniqueIdentifier = result.uniqueIdentifier;
    console.log('Retrieved unique identifier:', uniqueIdentifier);
  }
});

// Start/stop tracking based on tab activity
chrome.tabs.onActivated.addListener((activeInfo) => {
  console.log('Tab activated:', activeInfo.tabId); // Debugging
  checkTabAndTrack(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    console.log('Tab updated:', tabId, changeInfo.url); // Debugging
    checkTabAndTrack(tabId);
  }
});

// Handle idle state changes
chrome.idle.onStateChanged.addListener((newState) => {
  console.log('Idle state changed:', newState); // Debugging
  if (newState === 'active') {
    if (netflixTabId) {
      startTracking();
    }
  } else {
    stopTracking();
  }
});

function checkTabAndTrack(tabId) {
  chrome.tabs.get(tabId, function(tab) {
    if (chrome.runtime.lastError) {
      console.error('Error in checkTabAndTrack:', chrome.runtime.lastError);
      netflixTabId = null;
      stopTracking();
      return;
    }

    if (tab.url && tab.url.includes('netflix.com')) {
      console.log('Netflix tab detected. Starting tracking...'); // Debugging
      netflixTabId = tabId;
      startTracking();
    } else if (netflixTabId === tabId) {
      console.log('Leaving Netflix tab. Stopping tracking...'); // Debugging
      netflixTabId = null;
      stopTracking();
    }
  });
}

function startTracking() {
  if (!isTracking) {
    console.log('Tracking started.'); // Debugging
    isTracking = true;
    timer = setInterval(updateWatchtime, 60000); // Track every minute
  }
}

function stopTracking() {
  if (isTracking) {
    console.log('Tracking stopped.'); // Debugging
    isTracking = false;
    clearInterval(timer);
    updateWatchtime();
  }
}

function updateWatchtime() {
  console.log('Updating watchtime...'); // Debugging
  const elapsed = 60000; // 1 minute in milliseconds

  // Send data to Flask app
  sendDataToFlask(elapsed);
}

// Function to send data to Flask app
function sendDataToFlask(watchtime) {
  console.log('Sending data to Flask app...'); // Debugging
  const url = 'http://188.245.162.217:2523/update'; // Flask app URL
  const data = {
    watchtime: watchtime,
    uniqueIdentifier: uniqueIdentifier // Include the unique identifier
  };

  console.log('Data being sent:', data); // Debugging

  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })
    .then(response => response.json())
    .then(data => {
      console.log('Response from Flask app:', data);
    })
    .catch(error => {
      console.error('Error sending data to Flask app:', error);
    });
}