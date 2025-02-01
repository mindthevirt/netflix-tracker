let currentVideo = null;
let observer = null;
let isPlaying = false;
let lastPlayPauseTime = 0;
const DEBOUNCE_THRESHOLD = 100; // ms to ignore rapid play/pause events

// Safer message sending that doesn't throw on invalid context
function trySendMessage(message) {
    if (document.location.href.includes('/watch/')) {
        try {
            const sendPromise = chrome.runtime?.sendMessage(message);
            if (sendPromise && typeof sendPromise.catch === 'function') {
                sendPromise.catch(() => {});
            }
        } catch {
            // Ignore any errors
        }
    }
}

function handleVideoEnd() {
    if (document.location.href.includes('/watch/')) {
        isPlaying = false;
        trySendMessage({ action: 'videoStop' });
    }
}

function handleVideoPlay() {
    if (!document.location.href.includes('/watch/')) return;

    const currentTime = Date.now();
    console.log('Video play event detected', { currentTime, lastPlayPauseTime, diff: currentTime - lastPlayPauseTime });
    
    // Ignore play events that happen too quickly after a pause
    if (currentTime - lastPlayPauseTime < DEBOUNCE_THRESHOLD) {
        console.log('Ignoring play event - too close to previous event');
        return;
    }
    
    lastPlayPauseTime = currentTime;
    if (!isPlaying) {
        console.log('Starting video tracking');
        isPlaying = true;
        trySendMessage({ action: 'videoStart' });
    }
}

function handleVideoPause() {
    if (!document.location.href.includes('/watch/')) return;

    const currentTime = Date.now();
    console.log('Video pause event detected', { currentTime, lastPlayPauseTime, diff: currentTime - lastPlayPauseTime });
    
    // Ignore pause events that happen too quickly after a play
    if (currentTime - lastPlayPauseTime < DEBOUNCE_THRESHOLD) {
        console.log('Ignoring pause event - too close to previous event');
        return;
    }

    lastPlayPauseTime = currentTime;
    // Only send stop if video is actually paused
    if (currentVideo && !currentVideo.ended && 
        document.visibilityState === 'visible' && isPlaying) {
        console.log('Stopping video tracking');
        isPlaying = false;
        trySendMessage({ action: 'videoStop' });
    }
}

function handleVisibilityChange() {
    // Ignore visibility changes - don't update play state
    console.log('Visibility changed - ignoring');
}

function handleSeeking() {
    // Don't stop tracking on seeking
    console.log('Seeking - maintaining current state');
}

function handleSeeked() {
    // Don't change tracking state on seek completion
    console.log('Seeked - maintaining current state');
}

function cleanup() {
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
    if (currentVideo === video) {
        return;
    }

    if (currentVideo) {
        removeVideoListeners(currentVideo);
    }

    currentVideo = video;
    
    // Set up the video state listeners
    video.addEventListener('play', handleVideoPlay);
    video.addEventListener('pause', handleVideoPause);
    video.addEventListener('ended', handleVideoEnd);
    video.addEventListener('seeking', handleSeeking);
    video.addEventListener('seeked', handleSeeked);
    
    // Set initial state if video is already playing
    if (!video.paused) {
        isPlaying = true;
        trySendMessage({ action: 'videoStart' });
    }
}

function removeVideoListeners(video) {
    if (!video) return;
    
    video.removeEventListener('play', handleVideoPlay);
    video.removeEventListener('pause', handleVideoPause);
    video.removeEventListener('ended', handleVideoEnd);
    video.removeEventListener('seeking', handleSeeking);
    video.removeEventListener('seeked', handleSeeked);
}

function createOverlay(watchtime) {
    console.log('Creating overlay with watchtime:', watchtime);
    
    // Remove any existing overlay first
    const existingOverlay = document.querySelector('.netflix-limit-overlay');
    if (existingOverlay) {
        existingOverlay.remove();
    }

    // watchtime comes in as minutes already
    const hours = Math.floor(watchtime / 60);
    const minutes = Math.round(watchtime % 60);
    
    console.log('Calculated time:', { hours, minutes });
    
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
    
    // Pause video if playing
    if (currentVideo && !currentVideo.paused) {
        currentVideo.pause();
    }
    
    function resumePlayback() {
        if (currentVideo && wasPlaying) {
            currentVideo.play()
                .then(() => {
                    if (!isPlaying) {
                        isPlaying = true;
                        trySendMessage({ action: 'videoStart' });
                    }
                })
                .catch(error => {
                    console.error('Error resuming video:', error);
                    isPlaying = false;
                });
        }
    }

    function handleDismiss(minutes) {
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
            handleDismiss(minutes);
        }
    });

    // Add escape key handler (default to 5 minutes when using escape)
    const handleEscape = (event) => {
        if (event.key === 'Escape') {
            handleDismiss(5);
        }
    };
    
    // Add the escape key listener
    document.addEventListener('keydown', handleEscape);
}

function initializeIfWatchPage() {
    const isWatchPage = document.location.href.includes('/watch/');
    
    if (!isWatchPage) {
        cleanup();
        return;
    }

    if (!observer) {
        observer = new MutationObserver(() => {
            if (document.location.href.includes('/watch/')) {
                const videos = document.getElementsByTagName('video');
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
        if (videos.length > 0) {
            setupVideoListeners(videos[0]);
        }
    }
}

let lastUrl = document.location.href;

// Create a new observer for URL changes
const urlObserver = new MutationObserver(() => {
    if (document.location.href !== lastUrl) {
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
    if (request.action === 'showThresholdOverlay') {
        console.log('Received showThresholdOverlay message:', request);
        createOverlay(request.watchtime);
    }
});

// Initial setup
initializeIfWatchPage();

// Add visibility change handler
document.addEventListener('visibilitychange', handleVisibilityChange);

// Cleanup on unload
window.addEventListener('unload', () => {
    if (isPlaying) {
        trySendMessage({ action: 'videoStop' });
    }
    cleanup();
    urlObserver.disconnect();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
});