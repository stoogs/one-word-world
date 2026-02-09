/**
 * Spritz Engine - RSVP (Rapid Serial Visual Presentation) reader
 */

const SpritzEngine = {
    // State
    words: [],
    currentIndex: 0,
    wpm: 300,
    isPlaying: false,
    timerId: null,
    chapterTransitionDelay: 3000, // 3 seconds between chapters
    isChapterTransitioning: false,
    
    // Callbacks
    onWordChange: null,
    onChapterEnd: null,
    onPlayStateChange: null,
    onProgressChange: null,

    /**
     * Initialize the engine
     */
    init(options = {}) {
        this.wpm = options.wpm || 300;
        this.onWordChange = options.onWordChange || null;
        this.onChapterEnd = options.onChapterEnd || null;
        this.onPlayStateChange = options.onPlayStateChange || null;
        this.onProgressChange = options.onProgressChange || null;
        
        // Load saved settings
        const settings = StorageManager.getSettings();
        this.wpm = settings.wpm || 300;
        
        return this;
    },

    /**
     * Load words for current chapter
     */
    loadWords(words, startIndex = 0) {
        this.words = words || [];
        this.currentIndex = Math.max(0, Math.min(startIndex, this.words.length - 1));
        this.isChapterTransitioning = false;
        
        // Display initial word
        this.displayCurrentWord();
        this.updateProgress();
        
        return this;
    },

    /**
     * Start playback
     */
    play() {
        if (this.isPlaying) return;
        if (this.currentIndex >= this.words.length - 1) {
            this.currentIndex = 0;
        }
        
        this.isPlaying = true;
        this.scheduleNextWord();
        
        if (this.onPlayStateChange) {
            this.onPlayStateChange(true);
        }
    },

    /**
     * Pause playback
     */
    pause() {
        this.isPlaying = false;
        if (this.timerId) {
            clearTimeout(this.timerId);
            this.timerId = null;
        }
        
        if (this.onPlayStateChange) {
            this.onPlayStateChange(false);
        }
    },

    /**
     * Toggle play/pause
     */
    toggle() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    },

    /**
     * Go to next word
     */
    next() {
        this.pause();
        if (this.currentIndex < this.words.length - 1) {
            this.currentIndex++;
            this.displayCurrentWord();
            this.updateProgress();
        }
    },

    /**
     * Go to previous word
     */
    previous() {
        this.pause();
        if (this.currentIndex > 0) {
            this.currentIndex--;
            this.displayCurrentWord();
            this.updateProgress();
        }
    },

    /**
     * Jump to specific word
     */
    jumpTo(index) {
        this.pause();
        this.currentIndex = Math.max(0, Math.min(index, this.words.length - 1));
        this.displayCurrentWord();
        this.updateProgress();
    },

    /**
     * Set WPM
     */
    setWPM(wpm) {
        this.wpm = Math.max(50, Math.min(1000, wpm));
        StorageManager.saveSettings({ wpm: this.wpm });
        
        // If playing, restart with new speed
        if (this.isPlaying) {
            clearTimeout(this.timerId);
            this.scheduleNextWord();
        }
        
        return this.wpm;
    },

    /**
     * Get current WPM
     */
    getWPM() {
        return this.wpm;
    },

    /**
     * Schedule next word display
     */
    scheduleNextWord() {
        if (!this.isPlaying) return;
        
        const delay = this.calculateDelay();
        
        this.timerId = setTimeout(() => {
            this.advanceWord();
        }, delay);
    },

    /**
     * Calculate display delay for current word
     */
    calculateDelay() {
        // Special delay for chapter transition
        if (this.isChapterTransitioning) {
            return this.chapterTransitionDelay;
        }
        
        const baseDelay = 60000 / this.wpm; // ms per word
        const word = this.words[this.currentIndex] || '';
        
        // Add slight pause for punctuation
        const endsWithPunctuation = /[.!?]$/.test(word);
        const endsWithComma = /[,;]$/.test(word);
        
        if (endsWithPunctuation) {
            return baseDelay * 1.5;
        } else if (endsWithComma) {
            return baseDelay * 1.2;
        }
        
        return baseDelay;
    },

    /**
     * Advance to next word
     */
    advanceWord() {
        // Clear chapter transition flag after delay
        if (this.isChapterTransitioning) {
            this.isChapterTransitioning = false;
        }
        
        if (this.currentIndex < this.words.length - 1) {
            this.currentIndex++;
            this.displayCurrentWord();
            this.updateProgress();
            this.scheduleNextWord();
        } else {
            // End of chapter
            this.pause();
            if (this.onChapterEnd) {
                this.onChapterEnd();
            }
        }
    },

    /**
     * Display current word in Spritz format
     */
    displayCurrentWord() {
        if (this.words.length === 0) return;
        
        const word = this.words[this.currentIndex];
        const formatted = this.formatWord(word);
        
        if (this.onWordChange) {
            this.onWordChange({
                word,
                formatted,
                index: this.currentIndex,
                total: this.words.length,
                isNewChapter: this.isChapterTransitioning
            });
        }
    },

    /**
     * Format word for Spritz display (ORP alignment)
     */
    formatWord(word) {
        if (!word) return { left: '', center: '', right: '' };
        
        const length = word.length;
        let orpIndex;
        
        // ORP (Optimal Recognition Point) calculation
        if (length === 1) orpIndex = 0;
        else if (length <= 5) orpIndex = 1;
        else if (length <= 9) orpIndex = 2;
        else if (length <= 13) orpIndex = 3;
        else orpIndex = 4;
        
        return {
            left: word.substring(0, orpIndex),
            center: word[orpIndex] || '',
            right: word.substring(orpIndex + 1)
        };
    },

    /**
     * Mark start of new chapter
     */
    markNewChapter() {
        this.isChapterTransitioning = true;
    },

    /**
     * Update progress
     */
    updateProgress() {
        if (this.onProgressChange) {
            const progress = this.words.length > 0 
                ? (this.currentIndex / (this.words.length - 1)) * 100 
                : 0;
            this.onProgressChange(progress);
        }
    },

    /**
     * Get current position
     */
    getPosition() {
        return {
            index: this.currentIndex,
            total: this.words.length
        };
    },

    /**
     * Check if at end of chapter
     */
    isAtEnd() {
        return this.currentIndex >= this.words.length - 1;
    },

    /**
     * Destroy engine
     */
    destroy() {
        this.pause();
        this.words = [];
        this.currentIndex = 0;
    }
};