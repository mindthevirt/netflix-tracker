let currentVideo = null;
let observer = null;
let isPlaying = false;
let lastPlayPauseTime = 0;
const DEBOUNCE_THRESHOLD = 100; // ms to ignore rapid play/pause events

function debugLog(context, message, data = {}) {
    console.log(`[Debug] [${context}]`, message, {
        timestamp: new Date().toISOString(),
        url: document.location.href,
        ...data
    });
}

// Safer message sending that doesn't throw on invalid context
function trySendMessage(message) {
    if (document.location.href.includes('/watch/')) {
        debugLog('Message', 'Attempting to send message', { message });
        try {
            const sendPromise = chrome.runtime?.sendMessage(message);
            if (sendPromise && typeof sendPromise.catch === 'function') {
                sendPromise
                    .then(() => debugLog('Message', 'Message sent successfully', { message }))
                    .catch((error) => debugLog('Message', 'Failed to send message', { error, message }));
            }
        } catch (error) {
            debugLog('Message', 'Error sending message', { error, message });
        }
    } else {
        debugLog('Message', 'Not sending message - not on watch page');
    }
}

function handleVideoEnd() {
    debugLog('Video', 'Video ended event triggered');
    if (document.location.href.includes('/watch/')) {
        isPlaying = false;
        trySendMessage({ action: 'videoStop' });
    }
}

function handleVideoPlay() {
    if (!document.location.href.includes('/watch/')) {
        debugLog('Video', 'Play event ignored - not on watch page');
        return;
    }

    const currentTime = Date.now();
    debugLog('Video', 'Play event detected', {
        currentTime,
        lastPlayPauseTime,
        timeSinceLastEvent: currentTime - lastPlayPauseTime
    });
    
    // Ignore play events that happen too quickly after a pause
    if (currentTime - lastPlayPauseTime < DEBOUNCE_THRESHOLD) {
        debugLog('Video', 'Ignoring play event - too close to previous event');
        return;
    }
    
    lastPlayPauseTime = currentTime;
    if (!isPlaying) {
        debugLog('Video', 'Starting video tracking');
        isPlaying = true;
        trySendMessage({ action: 'videoStart' });
    } else {
        debugLog('Video', 'Video already being tracked');
    }
}

function handleVideoPause() {
    if (!document.location.href.includes('/watch/')) {
        debugLog('Video', 'Pause event ignored - not on watch page');
        return;
    }

    const currentTime = Date.now();
    debugLog('Video', 'Pause event detected', {
        currentTime,
        lastPlayPauseTime,
        timeSinceLastEvent: currentTime - lastPlayPauseTime
    });
    
    // Ignore pause events that happen too quickly after a play
    if (currentTime - lastPlayPauseTime < DEBOUNCE_THRESHOLD) {
        debugLog('Video', 'Ignoring pause event - too close to previous event');
        return;
    }

    lastPlayPauseTime = currentTime;
    // Only send stop if video is actually paused
    if (currentVideo && !currentVideo.ended && 
        document.visibilityState === 'visible' && isPlaying) {
        debugLog('Video', 'Stopping video tracking');
        isPlaying = false;
        trySendMessage({ action: 'videoStop' });
    }
}

function handleVisibilityChange() {
    debugLog('Visibility', 'Page visibility changed', {
        visibilityState: document.visibilityState,
        isPlaying,
        hasVideo: !!currentVideo
    });
}

function handleSeeking() {
    debugLog('Video', 'Seeking event detected', {
        currentTime: currentVideo?.currentTime
    });
}

function handleSeeked() {
    debugLog('Video', 'Seeked event completed', {
        currentTime: currentVideo?.currentTime
    });
}

function cleanup() {
    debugLog('Cleanup', 'Performing cleanup', {
        hadVideo: !!currentVideo,
        hadObserver: !!observer,
        wasPlaying: isPlaying
    });

    if (currentVideo) {
        removeVideoListeners(currentVideo);
        currentVideo = null;
    }
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    isPlaying = false;
}

function setupVideoListeners(video) {
    debugLog('Setup', 'Setting up video listeners', {
        currentVideo: currentVideo === video ? 'Same video' : 'New video',
        videoState: video ? {
            paused: video.paused,
            ended: video.ended,
            currentTime: video.currentTime,
            duration: video.duration
        } : 'No video'
    });

    if (currentVideo === video) {
        debugLog('Setup', 'Video already being tracked');
        return;
    }

    if (currentVideo) {
        debugLog('Setup', 'Removing listeners from old video');
        removeVideoListeners(currentVideo);
    }

    currentVideo = video;
    
    // Set up all video state listeners
    video.addEventListener('play', handleVideoPlay);
    video.addEventListener('pause', handleVideoPause);
    video.addEventListener('ended', handleVideoEnd);
    video.addEventListener('seeking', handleSeeking);
    video.addEventListener('seeked', handleSeeked);
    
    // Set initial state if video is already playing
    if (!video.paused) {
        debugLog('Setup', 'Video already playing on setup', {
            currentTime: video.currentTime,
            duration: video.duration
        });
        isPlaying = true;
        trySendMessage({ action: 'videoStart' });
    }
}

function removeVideoListeners(video) {
    if (!video) return;
    
    debugLog('Cleanup', 'Removing video listeners');
    video.removeEventListener('play', handleVideoPlay);
    video.removeEventListener('pause', handleVideoPause);
    video.removeEventListener('ended', handleVideoEnd);
    video.removeEventListener('seeking', handleSeeking);
    video.removeEventListener('seeked', handleSeeked);
}

function createOverlay(watchtime) {
    debugLog('Overlay', 'Creating overlay', { watchtime });
    
    // Remove any existing overlay first
    const existingOverlay = document.querySelector('.netflix-limit-overlay');
    if (existingOverlay) {
        existingOverlay.remove();
    }

    // watchtime comes in as minutes already
    const hours = Math.floor(watchtime / 60);
    const minutes = Math.round(watchtime % 60);
    
    const overlay = document.createElement('div');
    overlay.className = 'netflix-limit-overlay';
    
    const messages = [
        `You've watched ${hours} hour${hours !== 1 ? 's' : ''} and ${minutes} minute${minutes !== 1 ? 's' : ''} today!`,
        "Your real life is missing you...",
        "Time to touch some grass? ",
        "Netflix and chill? More like Netflix and STILL watching? ",
        "Your couch called, it needs a break! "
    ];
    
    overlay.innerHTML = `
        <h1>Woah there, binge master!</h1>
        <p>${messages[0]}</p>
        <p>${messages[Math.floor(Math.random() * (messages.length - 1)) + 1]}</p>
        <div class="netflix-limit-buttons">
            <button class="netflix-limit-extend" data-minutes="5">Just 5 more minutes...</button>
            <button class="netflix-limit-extend" data-minutes="15">Give me 15 minutes</button>
            <button class="netflix-limit-extend" data-minutes="30">Need 30 minutes!</button>
        </div>
    `;
    
    document.body.appendChild(overlay);
    
    // Add styles for the buttons container
    const style = document.createElement('style');
    style.textContent = `
        .netflix-limit-buttons {
            display: flex;
            gap: 10px;
            justify-content: center;
            margin-top: 20px;
        }
        .netflix-limit-extend {
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            background: rgba(229, 9, 20, 0.8);
            color: white;
            cursor: pointer;
            transition: background 0.2s;
        }
        .netflix-limit-extend:hover {
            background: rgba(229, 9, 20, 1);
        }
    `;
    document.head.appendChild(style);
    
    // Store the video state before pausing
    const wasPlaying = currentVideo && !currentVideo.paused;
    debugLog('Overlay', 'Storing video state', { wasPlaying });
    
    // Pause video if playing
    if (currentVideo && !currentVideo.paused) {
        debugLog('Overlay', 'Pausing video');
        currentVideo.pause();
    }
    
    function resumePlayback() {
        if (currentVideo && wasPlaying) {
            debugLog('Overlay', 'Resuming video playback');
            currentVideo.play()
                .then(() => {
                    if (!isPlaying) {
                        isPlaying = true;
                        trySendMessage({ action: 'videoStart' });
                    }
                })
                .catch(error => {
                    debugLog('Overlay', 'Error resuming video', { error });
                    isPlaying = false;
                });
        }
    }

    function handleDismiss(minutes) {
        debugLog('Overlay', 'Handling overlay dismiss', { minutes });
        const overlay = document.querySelector('.netflix-limit-overlay');
        if (overlay) {
            overlay.remove();
            resumePlayback();
            // Send message to extend watchtime by specified minutes
            chrome.runtime.sendMessage({ action: 'extendWatchtime', minutes: minutes });
        }
        document.removeEventListener('keydown', handleEscape);
    }
    
    // Handle extend buttons with event delegation
    overlay.addEventListener('click', (event) => {
        const button = event.target.closest('.netflix-limit-extend');
        if (button) {
            const minutes = parseInt(button.dataset.minutes, 10);
            debugLog('Overlay', 'Extension button clicked', { minutes });
            handleDismiss(minutes);
        }
    });

    // Add escape key handler (default to 5 minutes when using escape)
    const handleEscape = (event) => {
        if (event.key === 'Escape') {
            debugLog('Overlay', 'Escape key pressed, extending by 5 minutes');
            handleDismiss(5);
        }
    };
    
    // Add the escape key listener
    document.addEventListener('keydown', handleEscape);
}

function initializeIfWatchPage() {
    const isWatchPage = document.location.href.includes('/watch/');
    debugLog('Init', 'Initializing watch page detection', { isWatchPage });
    
    if (!isWatchPage) {
        debugLog('Init', 'Not a watch page, cleaning up');
        cleanup();
        return;
    }

    if (!observer) {
        debugLog('Init', 'Setting up new mutation observer');
        observer = new MutationObserver(() => {
            if (document.location.href.includes('/watch/')) {
                const videos = document.getElementsByTagName('video');
                debugLog('Observer', 'DOM mutation detected', { videosFound: videos.length });
                if (videos.length > 0) {
                    setupVideoListeners(videos[0]);
                }
            }
        });

        observer.observe(document.body, { 
            childList: true, 
            subtree: true 
        });

        const videos = document.getElementsByTagName('video');
        debugLog('Init', 'Checking for existing videos', { videosFound: videos.length });
        if (videos.length > 0) {
            setupVideoListeners(videos[0]);
        }
    }
}

let lastUrl = document.location.href;
debugLog('Init', 'Initial page load', { url: lastUrl });

// Create a new observer for URL changes
const urlObserver = new MutationObserver(() => {
    if (document.location.href !== lastUrl) {
        debugLog('Navigation', 'URL changed', {
            from: lastUrl,
            to: document.location.href
        });
        lastUrl = document.location.href;
        initializeIfWatchPage();
    }
});

urlObserver.observe(document.querySelector('html'), {
    subtree: true,
    childList: true
});

// Add message listener for threshold reached
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    debugLog('Message', 'Received message', { request });
    if (request.action === 'showThresholdOverlay') {
        createOverlay(request.watchtime);
    }
});

// Initial setup
initializeIfWatchPage();

// Add visibility change handler
document.addEventListener('visibilitychange', handleVisibilityChange);

// Cleanup on unload
window.addEventListener('unload', () => {
    debugLog('Unload', 'Page unloading', { wasPlaying: isPlaying });
    if (isPlaying) {
        trySendMessage({ action: 'videoStop' });
    }
    cleanup();
    urlObserver.disconnect();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
});