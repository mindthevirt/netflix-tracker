let uniqueIdentifier = null;
let activeWatching = new Map(); // Map of tabId to watching state
let sessionTimes = new Map(); // Map of tabId to session info
let pendingUpdates = [];
const RETRY_DELAY = 5000;
const ALARM_NAME = 'updateWatchtimeAlarm';

function debugLog(action, message, data = {}) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${action}]`, message, data);
}

// Initialize alarms
chrome.alarms.create(ALARM_NAME, {
    periodInMinutes: 0.5 // Run every 30 seconds
});

// Listen for alarm events
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
        updateActiveSessions();
    }
});

// Initialize unique identifier
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
        processPendingUpdates();
    } catch (error) {
        console.error('Error initializing unique identifier:', error);
        setTimeout(initializeUniqueIdentifier, RETRY_DELAY);
    }
}

function generateFallbackUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Start initialization
initializeUniqueIdentifier();

// Handle tab updates and URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
        debugLog('Tab', `URL changed for tab ${tabId}`, { url: changeInfo.url });
        if (!tab.url?.includes('netflix.com/watch/')) {
            stopTrackingForTab(tabId);
        }
    }
});

// Handle tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
    debugLog('Tab', `Tab ${tabId} removed`);
    stopTrackingForTab(tabId);
});

// Keep service worker alive while tracking
async function keepAlive() {
    if (activeWatching.size > 0) {
        const keepAlivePort = chrome.runtime.connect({ name: 'keepAlive' });
        keepAlivePort.disconnect();
    }
}

// Track video state for each tab
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

function updateWatchtime(duration) {
    debugLog('Watchtime', 'Updating watchtime', { duration });
    if (!uniqueIdentifier) {
        debugLog('Watchtime', 'No identifier, queueing update', { duration });
        pendingUpdates.push(duration);
        return;
    }
    sendDataToFlask(duration);
}

async function processPendingUpdates() {
    debugLog('Updates', `Processing ${pendingUpdates.length} pending updates`);
    while (pendingUpdates.length > 0) {
        const duration = pendingUpdates.shift();
        await sendDataToFlask(duration);
    }
}

async function sendDataToFlask(watchtime) {
    const url = 'http://188.245.162.217:2523/update';
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

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender) => {
    if (!sender.tab) return;
    
    const tabId = sender.tab.id;
    debugLog('Message', `Received message for tab ${tabId}`, { action: request.action });
    
    if (request.action === 'videoStart') {
        startTrackingForTab(tabId);
    } else if (request.action === 'videoStop') {
        stopTrackingForTab(tabId);
    }
});