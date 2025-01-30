// Initial variables
let uniqueIdentifier = null;
let activeWatching = new Map(); // Map of tabId to watching state
let sessionTimes = new Map(); // Map of tabId to session info
let pendingUpdates = [];
let dailyWatchtime = 0;
let lastDayChecked = new Date().toDateString();
let watchTimeExtension = 0;

const RETRY_DELAY = 5000;
const ALARM_NAME = 'updateWatchtimeAlarm';
const API_BASE_URL = 'https://binge-master.mindthevirt.com/get-watchtime';

// Utility functions
function debugLog(action, message, data = {}) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${action}]`, message, data);
}

function generateFallbackUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// API communication
async function sendDataToFlask(watchtime) {
    const url = `${API_BASE_URL}/update`;
    const data = {
        watchtime,
        uniqueIdentifier
    };

    debugLog('API', 'Sending data to Flask', data);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        debugLog('API', 'Watch time updated successfully', result);
    } catch (error) {
        console.error('Error sending data to Flask app:', error);
        debugLog('API', 'Error sending data, will retry', { error: error.message });
        setTimeout(() => sendDataToFlask(watchtime), RETRY_DELAY);
    }
}

// Get daily watchtime from API
async function getDailyWatchtime() {
    try {
        const response = await fetch(`${API_BASE_URL}/get-watchtime?uniqueIdentifier=${uniqueIdentifier}`);
        const data = await response.json();
        
        if (data.status === 'success') {
            // Calculate total watchtime for today only
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            
            const todayWatchtime = data.data
                .filter(entry => new Date(entry.timestamp) >= todayStart)
                .reduce((total, entry) => total + entry.watchtime, 0);
            
            debugLog('API', 'Retrieved daily watchtime', { todayWatchtime });
            return todayWatchtime;
        }
    } catch (error) {
        console.error('Error fetching daily watchtime:', error);
    }
    return 0;
}

// Process pending updates
async function processPendingUpdates() {
    debugLog('Updates', `Processing ${pendingUpdates.length} pending updates`);
    while (pendingUpdates.length > 0) {
        const duration = pendingUpdates.shift();
        await sendDataToFlask(duration);
    }
}

// Daily watchtime management
async function checkAndResetDaily() {
    const today = new Date().toDateString();
    if (today !== lastDayChecked) {
        dailyWatchtime = 0;
        watchTimeExtension = 0; // Reset extension time on new day
        lastDayChecked = today;
    }
    
    // Sync with API data
    const apiDailyWatchtime = await getDailyWatchtime();
    dailyWatchtime = apiDailyWatchtime; // API returns milliseconds
    debugLog('Daily Reset', 'Daily watchtime synced with API', { dailyWatchtime });
}

async function updateWatchtime(duration) {
    debugLog('Watchtime', 'Updating watchtime', { duration });
    if (!uniqueIdentifier) {
        debugLog('Watchtime', 'No identifier, queueing update', { duration });
        pendingUpdates.push(duration);
        return;
    }

    try {
        // Check and reset daily watchtime if needed
        await checkAndResetDaily();
        
        // Send to API first
        await sendDataToFlask(duration);
        
        // Check if we should show the overlay
        const result = await chrome.storage.sync.get(['dailyLimit']);
        const limit = result.dailyLimit || 0;
        
        if (limit > 0) {
            // Convert milliseconds to minutes for comparison
            const minutesWatched = Math.floor(dailyWatchtime / 60000);
            debugLog('Limit Check', 'Checking watchtime against limit', { minutesWatched, limit });
            
            if (minutesWatched >= limit && watchTimeExtension <= 0) {
                const tabs = await chrome.tabs.query({
                    url: "*://*.netflix.com/*"
                });
                
                for (const tab of tabs) {
                    if (tab.url.includes('/watch/')) {
                        try {
                            debugLog('Overlay', 'Showing overlay', { tabId: tab.id, minutesWatched });
                            await chrome.tabs.sendMessage(tab.id, {
                                action: 'showThresholdOverlay',
                                watchtime: minutesWatched
                            });
                        } catch (error) {
                            debugLog('Overlay', `Failed to send overlay message to tab ${tab.id}`, { error });
                        }
                    }
                }
            }
        }
    } catch (error) {
        debugLog('Watchtime', 'Error updating watchtime', { error });
        pendingUpdates.push(duration);
    }
}

// Tab management
function startTrackingForTab(tabId) {
    const currentTime = Date.now();
    debugLog('Tracking', `Starting tracking for tab ${tabId}`, { currentTime });
    
    sessionTimes.set(tabId, {
        startTime: currentTime,
        lastUpdateTime: currentTime
    });
    activeWatching.set(tabId, true);
    
    // Ensure service worker stays alive
    keepAlive();
}

function stopTrackingForTab(tabId) {
    if (activeWatching.get(tabId)) {
        const sessionInfo = sessionTimes.get(tabId);
        if (sessionInfo) {
            const currentTime = Date.now();
            const duration = currentTime - sessionInfo.lastUpdateTime;
            
            debugLog('Tracking', `Stopping tracking for tab ${tabId}`, {
                sessionStart: new Date(sessionInfo.startTime).toISOString(),
                lastUpdate: new Date(sessionInfo.lastUpdateTime).toISOString(),
                duration: duration
            });

            if (duration > 0) {
                updateWatchtime(duration);
            }
        }
        activeWatching.set(tabId, false);
        sessionTimes.delete(tabId);
    }
}

// Keep alive functionality
async function keepAlive() {
    if (activeWatching.size > 0) {
        const keepAlivePort = chrome.runtime.connect({ name: 'keepAlive' });
        keepAlivePort.disconnect();
    }
}

// Session management
function updateActiveSessions() {
    const currentTime = Date.now();
    debugLog('Update', 'Running periodic update check', {
        activeSessions: activeWatching.size
    });
    
    for (const [tabId, isWatching] of activeWatching.entries()) {
        if (isWatching) {
            const sessionInfo = sessionTimes.get(tabId);
            if (sessionInfo) {
                const duration = currentTime - sessionInfo.lastUpdateTime;
                
                debugLog('Update', `Updating session for tab ${tabId}`, {
                    duration: duration,
                    lastUpdate: new Date(sessionInfo.lastUpdateTime).toISOString()
                });

                if (duration > 0) {
                    updateWatchtime(duration);
                    sessionInfo.lastUpdateTime = currentTime;
                    sessionTimes.set(tabId, sessionInfo);
                }
            }
        }
    }

    // Keep alive if still tracking
    if (activeWatching.size > 0) {
        keepAlive();
    }
}

// Initialization
async function initializeUniqueIdentifier() {
    try {
        const result = await chrome.storage.local.get(['uniqueIdentifier']);
        if (!result.uniqueIdentifier) {
            uniqueIdentifier = crypto.randomUUID?.() || generateFallbackUUID();
            await chrome.storage.local.set({ uniqueIdentifier });
        } else {
            uniqueIdentifier = result.uniqueIdentifier;
        }
        debugLog('Init', 'Unique identifier ready', { uniqueIdentifier });
        await processPendingUpdates();
    } catch (error) {
        console.error('Error initializing unique identifier:', error);
        setTimeout(initializeUniqueIdentifier, RETRY_DELAY);
    }
}

// Event listeners
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
        debugLog('Tab', `URL changed for tab ${tabId}`, { url: changeInfo.url });
        if (!tab.url?.includes('netflix.com/watch/')) {
            stopTrackingForTab(tabId);
        }
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    debugLog('Tab', `Tab ${tabId} removed`);
    stopTrackingForTab(tabId);
});

// Combined message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Handle watchtime extension
    if (request.action === 'extendWatchtime') {
        const additionalMinutes = request.minutes;
        // Convert to milliseconds and add to extension
        watchTimeExtension += additionalMinutes * 60 * 1000;
        debugLog('Extension', `Added ${additionalMinutes} minutes to watch time allowance`);
        
        // Set a timer to recheck when extension expires
        setTimeout(async () => {
            watchTimeExtension = 0;
            debugLog('Extension', 'Extension time expired, rechecking limit');
            // Force a recheck of the limit
            const result = await chrome.storage.sync.get(['dailyLimit']);
            const limit = result.dailyLimit || 0;
            const minutesWatched = Math.floor(dailyWatchtime / 60000);
            
            if (limit > 0 && minutesWatched >= limit) {
                const tabs = await chrome.tabs.query({
                    url: "*://*.netflix.com/*"
                });
                
                for (const tab of tabs) {
                    if (tab.url.includes('/watch/')) {
                        try {
                            debugLog('Overlay', 'Showing overlay after extension expired', { tabId: tab.id, minutesWatched });
                            await chrome.tabs.sendMessage(tab.id, {
                                action: 'showThresholdOverlay',
                                watchtime: minutesWatched
                            });
                        } catch (error) {
                            debugLog('Overlay', `Failed to send overlay message to tab ${tab.id}`, { error });
                        }
                    }
                }
            }
        }, additionalMinutes * 60 * 1000);
        return;
    }

    // Handle video state changes (requires tab context)
    if (sender.tab) {
        const tabId = sender.tab.id;
        debugLog('Message', `Received message for tab ${tabId}`, { action: request.action });
        
        if (request.action === 'videoStart') {
            startTrackingForTab(tabId);
        } else if (request.action === 'videoStop') {
            stopTrackingForTab(tabId);
        }
    }
});

// Initialize alarms
chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: 0.5 // Run every 30 seconds
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
        updateActiveSessions();
    }
});

// Start initialization
initializeUniqueIdentifier();