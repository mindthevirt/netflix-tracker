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
const API_BASE_URL = 'https://binge-master.mindthevirt.com';

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
async function makeAuthenticatedRequest(endpoint, options = {}) {
    const { apiKey } = await chrome.storage.local.get('apiKey');
    if (!apiKey) {
        console.error('No API key found');
        return;
    }

    const headers = {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        ...(options.headers || {})
    };

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            ...options,
            headers
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error('Request failed:', error);
        throw error;
    }
}

async function sendDataToFlask(watchtime) {
    const data = {
        watchtime,
        uniqueIdentifier,
        trackingEnabled: true, // default to true if not set
        dailyLimit: 0 // default to 0 if not set
    };

    debugLog('API Request', 'Sending watchtime update', {
        url: '/update',
        method: 'POST',
        ...data
    });

    try {
        await makeAuthenticatedRequest('/update', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        const result = await makeAuthenticatedRequest('/get-watchtime');
        debugLog('API Success', 'Watch time updated successfully', {
            response: result,
            sentData: data
        });
    } catch (error) {
        console.error('Error sending data to Flask app:', error);
        debugLog('API Error', 'Error sending data, scheduling retry', {
            error: error.message,
            retryDelay: RETRY_DELAY,
            watchtime
        });
        setTimeout(() => sendDataToFlask(watchtime), RETRY_DELAY);
    }
}

// Get daily watchtime from API
async function getDailyWatchtime() {
    try {
        const result = await makeAuthenticatedRequest('/get-watchtime');
        if (result.status === 'success') {
            // Calculate total watchtime for today only
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            
            const todayWatchtime = result.data
                .filter(entry => new Date(entry.timestamp) >= todayStart)
                .reduce((total, entry) => total + entry.watchtime, 0);
            
            debugLog('API Success', 'Retrieved daily watchtime', {
                todayWatchtime,
                entriesCount: result.data.length,
                todayStart: todayStart.toISOString()
            });
            return todayWatchtime;
        } else {
            debugLog('API Warning', 'Unexpected response status', {
                status: result.status,
                data: result
            });
        }
    } catch (error) {
        console.error('Error fetching daily watchtime:', error);
        debugLog('API Error', 'Failed to fetch daily watchtime', {
            error: error.message,
            url: '/get-watchtime'
        });
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
    
    // Check if tracking is enabled
    const { trackingEnabled } = await chrome.storage.sync.get(['trackingEnabled']);
    if (trackingEnabled === false) {
        debugLog('Watchtime', 'Tracking is disabled, skipping update');
        return;
    }
    
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
async function updateActiveSessions() {
    debugLog('Sessions', 'Updating active sessions', { activeCount: activeWatching.size });
    
    for (const [tabId, isActive] of activeWatching.entries()) {
        if (!isActive) continue;

        const sessionInfo = sessionTimes.get(tabId);
        if (!sessionInfo) {
            debugLog('Sessions', `No session info for tab ${tabId}, skipping`);
            continue;
        }

        try {
            const tab = await chrome.tabs.get(tabId);
            if (!tab.url?.includes('netflix.com/watch/')) {
                debugLog('Sessions', `Tab ${tabId} no longer on Netflix watch page, stopping tracking`);
                stopTrackingForTab(tabId);
                continue;
            }

            const currentTime = Date.now();
            const duration = currentTime - sessionInfo.lastUpdateTime;
            
            debugLog('Sessions', `Updating session for tab ${tabId}`, {
                sessionStart: new Date(sessionInfo.startTime).toISOString(),
                lastUpdate: new Date(sessionInfo.lastUpdateTime).toISOString(),
                duration: duration
            });

            if (duration > 0) {
                await updateWatchtime(duration);
                sessionTimes.set(tabId, {
                    ...sessionInfo,
                    lastUpdateTime: currentTime
                });
            }
        } catch (error) {
            debugLog('Sessions', `Error updating session for tab ${tabId}`, { error });
            // Tab might have been closed
            stopTrackingForTab(tabId);
        }
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

// Listen for changes in storage
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.trackingEnabled) {
        debugLog('Settings', 'Tracking setting changed', { 
            newValue: changes.trackingEnabled.newValue 
        });
        
        if (changes.trackingEnabled.newValue === false) {
            // Stop tracking all active sessions
            for (const [tabId] of activeWatching.entries()) {
                stopTrackingForTab(tabId);
            }
            activeWatching.clear();
            sessionTimes.clear();
        } else {
            // Re-check all Netflix tabs to start tracking if needed
            chrome.tabs.query({ url: "*://*.netflix.com/*" }, (tabs) => {
                tabs.forEach(tab => {
                    if (tab.url?.includes('/watch/')) {
                        startTrackingForTab(tab.id);
                    }
                });
            });
        }
    }
});

// Listen for changes to the uniqueIdentifier in storage
chrome.storage.local.onChanged.addListener((changes) => {
    if (changes.uniqueIdentifier) {
        uniqueIdentifier = changes.uniqueIdentifier.newValue;
        debugLog('Storage', 'Updated uniqueIdentifier from storage change', { uniqueIdentifier });
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
async function initializeUniqueIdentifier() {
    debugLog('Initialization', 'Starting uniqueIdentifier initialization');
    try {
        const result = await chrome.storage.local.get(['uniqueIdentifier']);
        
        if (result.uniqueIdentifier) {
            uniqueIdentifier = result.uniqueIdentifier;
            debugLog('Initialization', 'Retrieved existing uniqueIdentifier', { uniqueIdentifier });
            // Process any pending updates that accumulated while waiting for uniqueIdentifier
            if (pendingUpdates.length > 0) {
                debugLog('Initialization', 'Processing pending updates', { count: pendingUpdates.length });
                await processPendingUpdates();
            }
        } else {
            uniqueIdentifier = crypto.randomUUID?.() || generateFallbackUUID();
            debugLog('Initialization', 'Generated new uniqueIdentifier', { uniqueIdentifier });
            await chrome.storage.local.set({ uniqueIdentifier });
        }
    } catch (error) {
        console.error('Error initializing unique identifier:', error);
        setTimeout(initializeUniqueIdentifier, RETRY_DELAY);
    }
}

initializeUniqueIdentifier();