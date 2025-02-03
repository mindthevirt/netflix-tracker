// Get elements
const trackingEnabled = document.getElementById('trackingEnabled');
// const notificationsEnabled = document.getElementById('notificationsEnabled');
const resetButton = document.getElementById('resetButton');
const exportButton = document.getElementById('exportButton');
const dailyLimit = document.getElementById('dailyLimit');

// Load current settings
chrome.storage.sync.get(['trackingEnabled'], (result) => {
  trackingEnabled.checked = result.trackingEnabled !== false;
  // notificationsEnabled.checked = result.notificationsEnabled || false;
});

// Save settings when changed
trackingEnabled.addEventListener('change', () => {
  chrome.storage.sync.set({ trackingEnabled: trackingEnabled.checked });
});

// Notifications toggle - Currently not implemented
/*
notificationsEnabled.addEventListener('change', () => {
  chrome.storage.sync.set({ notificationsEnabled: notificationsEnabled.checked });
});
*/

// Reset watchtime
resetButton.addEventListener('click', () => {
  if (confirm('Are you sure you want to reset your watchtime?')) {
    chrome.storage.local.set({ watchtime: 0 }, () => {
      alert('Watchtime has been reset');
    });
  }
});

// Export data
exportButton.addEventListener('click', () => {
  chrome.storage.local.get(['watchtime', 'watchHistory'], (result) => {
    const data = [
      ['Date', 'Watchtime (minutes)'], // Updated to minutes
      ...(result.watchHistory || []).map(entry => [
        new Date(entry.timestamp).toLocaleDateString(),
        (entry.duration / 60000).toFixed(0) // Convert to minutes
      ])
    ];
    
    const csvContent = "data:text/csv;charset=utf-8," 
      + data.map(row => row.join(",")).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "netflix_watchtime.csv");
    document.body.appendChild(link);
    link.click();
  });
});

// Load daily limit setting
chrome.storage.sync.get(['dailyLimit'], (result) => {
  dailyLimit.value = result.dailyLimit || 0;
});

// Save daily limit when changed
dailyLimit.addEventListener('change', () => {
  const limit = parseInt(dailyLimit.value, 10);
  chrome.storage.sync.set({ dailyLimit: limit });
});