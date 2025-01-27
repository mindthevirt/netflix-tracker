let timer;
let isTracking = false;
let netflixTabId = null;
let uniqueIdentifier = null;
let activeWatching = false;

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
      console.log('Stored unique identifier:', uniqueIdentifier);
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
  if (newState === 'active' && netflixTabId) {
    startTracking();
  } else {
    stopTracking();
  }
});

function checkTabAndTrack(tabId) {
  chrome.tabs.get(tabId, function(tab) {
    if (chrome.runtime.lastError || !tab.url || !tab.url.includes('netflix.com')) {
      console.log('Not a Netflix tab or tab error:', chrome.runtime.lastError);
      netflixTabId = null;
      stopTracking();
      return;
    }
    console.log('Netflix tab detected. Starting tracking...'); // Debugging
    netflixTabId = tabId;
    startTracking();
  });
}

function startTracking() {
  if (!isTracking) {
    console.log('Tracking started.'); // Debugging
    isTracking = true;
    checkActiveWatching();
  }
}

function stopTracking() {
  if (isTracking) {
    console.log('Tracking stopped.'); // Debugging
    isTracking = false;
    activeWatching = false;
    clearInterval(timer);
  }
}

function checkActiveWatching() {
  chrome.tabs.get(netflixTabId, (tab) => {
    if (chrome.runtime.lastError) {
      console.error('Error getting tab:', chrome.runtime.lastError);
      activeWatching = false;
      stopActiveTracking();
      return;
    }

    if (tab && tab.active) {
      activeWatching = true;
      startActiveTracking();
    } else {
      activeWatching = false;
      stopActiveTracking();
    }
  });
}

function startActiveTracking() {
  if (!activeWatching) {
    console.log('Active watching started.'); // Debugging
    activeWatching = true;
    startTrackingSession();
  }
}

function stopActiveTracking() {
  if (activeWatching) {
    console.log('Active watching stopped.'); // Debugging
    activeWatching = false;
    stopTrackingSession();
  }
}

let sessionStartTime;

function startTrackingSession() {
  sessionStartTime = Date.now();
  console.log('Session started at:', new Date(sessionStartTime).toISOString(), 'Start time:', sessionStartTime);
}

function stopTrackingSession() {
  if (!sessionStartTime) {
    console.error('Session start time is not set!');
    return;
  }
  const sessionDuration = Date.now() - sessionStartTime;
  console.log('Session stopped. Duration:', sessionDuration, 'ms');
  updateWatchtime(sessionDuration);
}

function updateWatchtime(duration) {
  console.log('Updating watchtime with duration:', duration, 'ms');
  sendDataToFlask(duration);
}

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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'videoStart') {
    startActiveTracking();
  } else if (request.action === 'videoStop') {
    stopActiveTracking();
  }
});