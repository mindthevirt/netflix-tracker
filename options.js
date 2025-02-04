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
exportButton.addEventListener('click', async () => {
  try {
    // First get the unique identifier
    const result = await chrome.storage.local.get(['uniqueIdentifier']);
    if (!result.uniqueIdentifier) {
      throw new Error('No unique identifier found');
    }

    // Make API request with the identifier
    const response = await fetch(`https://binge-master.mindthevirt.com/get-watchtime?uniqueIdentifier=${result.uniqueIdentifier}`);
    if (!response.ok) {
      throw new Error('Failed to fetch watchtime data');
    }
    const watchData = await response.json();
    console.log('Raw API response:', watchData);
    
    // Ensure we have an array to work with
    const watchDataArray = Array.isArray(watchData) ? watchData : 
                         watchData.data ? watchData.data :
                         watchData.watchtime ? watchData.watchtime :
                         Object.values(watchData);
                         
    console.log('Processed watch data array:', watchDataArray);
    
    if (!Array.isArray(watchDataArray)) {
      throw new Error('Invalid data format received from server');
    }
    
    // Prepare CSV data
    const data = [
      ['Timestamp', 'Watchtime (minutes)'],
      ...watchDataArray.map(entry => [
        entry.timestamp,
        (entry.watchtime / 60000).toFixed(2) // Convert milliseconds to minutes with 2 decimal places
      ])
    ];
    
    // Create and download CSV
    const csvContent = "data:text/csv;charset=utf-8," 
      + data.map(row => row.join(",")).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "netflix_watchtime.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (error) {
    console.error('Export error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack
    });
    alert('Failed to export data: ' + error.message);
  }
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