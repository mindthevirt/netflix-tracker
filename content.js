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
    // Ignore play events that happen too quickly after a pause
    if (currentTime - lastPlayPauseTime < DEBOUNCE_THRESHOLD) {
        console.log('Ignoring play event - too close to previous event');
        return;
    }
    
    lastPlayPauseTime = currentTime;
    if (!isPlaying) {
        isPlaying = true;
        trySendMessage({ action: 'videoStart' });
    }
}

function handleVideoPause() {
    if (!document.location.href.includes('/watch/')) return;

    const currentTime = Date.now();
    // Ignore pause events that happen too quickly after a play
    if (currentTime - lastPlayPauseTime < DEBOUNCE_THRESHOLD) {
        console.log('Ignoring pause event - too close to previous event');
        return;
    }

    lastPlayPauseTime = currentTime;
    // Only send stop if video is actually paused
    if (currentVideo && !currentVideo.ended && 
        document.visibilityState === 'visible' && isPlaying) {
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