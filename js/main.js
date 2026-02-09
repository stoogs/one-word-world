/**
 * Main Entry Point - EPUB Reader Application
 * 
 * This file initializes all modules and connects them together.
 */

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('📚 EPUB Reader initializing...');
    
    // Initialize all modules
    initializeApp();
});

/**
 * Initialize the application
 */
function initializeApp() {
    // Initialize storage first (other modules depend on it)
    StorageManager.init();
    
    // Initialize theme manager
    ThemeManager.init();
    
    // Initialize Spritz engine with callbacks
    SpritzEngine.init({
        wpm: StorageManager.getSettings().wpm || 300,
        onWordChange: handleWordChange,
        onPlayStateChange: handlePlayStateChange,
        onProgressChange: handleProgressChange,
        onChapterEnd: handleChapterEnd
    });
    
    // Initialize UI controller
    UIController.init();
    
    // Setup auto-save interval
    setupAutoSave();
    
    console.log('✅ EPUB Reader ready!');
    console.log('Keyboard shortcuts:');
    console.log('  Space - Play/Pause');
    console.log('  ←/→ - Previous/Next word');
    console.log('  ↑/↓ - Adjust WPM');
}

/**
 * Handle word change from Spritz engine
 */
function handleWordChange(data) {
    // Update Spritz display
    UIController.updateSpritzWord(data);
    
    // Highlight word in chapter panel
    UIController.highlightWordInPanel(data.index);
    
    // Auto-save progress periodically (every 20 words)
    if (data.index % 20 === 0) {
        saveCurrentProgress();
    }
}

/**
 * Handle play state change
 */
function handlePlayStateChange(isPlaying) {
    UIController.updatePlayButton(isPlaying);
}

/**
 * Handle progress change
 */
function handleProgressChange(percentage) {
    UIController.updateProgress(percentage);
}

/**
 * Handle chapter end
 */
function handleChapterEnd() {
    console.log('Chapter ended, loading next...');
    UIController.handleChapterEnd();
}

/**
 * Setup auto-save interval
 */
function setupAutoSave() {
    // Save progress every 5 seconds while reading
    setInterval(() => {
        if (SpritzEngine.isPlaying) {
            saveCurrentProgress();
        }
    }, 5000);
}

/**
 * Save current reading progress
 */
function saveCurrentProgress() {
    const book = UIController.currentBook;
    const chapter = UIController.currentChapter;
    const position = SpritzEngine.getPosition();
    
    if (book && chapter) {
        StorageManager.saveProgress(
            book.id,
            chapter.index,
            position.index
        );
    }
}

/**
 * Handle page visibility change (save progress when user leaves)
 */
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        saveCurrentProgress();
    }
});

/**
 * Handle beforeunload (save progress when closing)
 */
window.addEventListener('beforeunload', () => {
    saveCurrentProgress();
});

/**
 * Expose app version
 */
window.EPUB_READER_VERSION = '1.0.0';