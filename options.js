// Get elements
const trackingEnabled = document.getElementById('trackingEnabled');
// const notificationsEnabled = document.getElementById('notificationsEnabled');
const resetButton = document.getElementById('resetButton');
const exportButton = document.getElementById('exportButton');
const dailyLimit = document.getElementById('dailyLimit');

// Function to make authenticated requests
async function makeAuthenticatedRequest(endpoint) {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) {
    throw new Error('No API key available');
  }

  const response = await fetch(`https://binge-master.mindthevirt.com${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return response.json();
}

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
resetButton.addEventListener('click', async () => {
  if (confirm('Are you sure you want to reset your data?')) {
    try {
      // Get current unique identifier
      const result = await chrome.storage.local.get(['uniqueIdentifier']);
      if (!result.uniqueIdentifier) {
        throw new Error('No unique identifier found');
      }

      let currentId = result.uniqueIdentifier;
      let newId;

      // Check if the ID already has our custom number suffix
      const match = currentId.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(\d+)$/);
      if (match) {
        // If it has a number, increment it
        const baseUUID = match[1];
        const currentNum = parseInt(match[2]);
        newId = `${baseUUID}-${currentNum + 1}`;
      } else {
        // If it doesn't have a number and is a valid UUID, add -1
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(currentId)) {
          newId = `${currentId}-1`;
        } else {
          throw new Error('Invalid identifier format');
        }
      }

      // Save the new identifier and reset watchtime
      await chrome.storage.local.set({ 
        uniqueIdentifier: newId,
        watchtime: 0  // Reset watchtime as well
      });

      // Find and reload all Netflix tabs
      const tabs = await chrome.tabs.query({ url: '*://*.netflix.com/*' });
      for (const tab of tabs) {
        await chrome.tabs.reload(tab.id);
      }
    } catch (error) {
      console.error('Error resetting data:', error);
      alert('Failed to reset data: ' + error.message);
    }
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

    // Make authenticated API request with the identifier
    const watchData = await makeAuthenticatedRequest(`/get-watchtime?uniqueIdentifier=${result.uniqueIdentifier}`);
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

    // Format the data for CSV
    const csvContent = [
      ['Date', 'Watchtime (minutes)'],
      ...watchDataArray.map(entry => [
        new Date(entry.timestamp).toLocaleString(),
        (entry.watchtime / 60000).toFixed(2)
      ])
    ].map(row => row.join(',')).join('\n');

    // Create and trigger download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `netflix-watchtime-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch (error) {
    console.error('Error exporting data:', error);
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