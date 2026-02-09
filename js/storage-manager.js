/**
 * Storage Manager - Handles localStorage for library, progress, and settings
 */

const StorageManager = {
    KEYS: {
        LIBRARY: 'epub-library',
        PROGRESS: 'epub-progress',
        SETTINGS: 'epub-settings'
    },

    MAX_STORAGE_SIZE: 10 * 1024 * 1024, // 10MB limit for book storage

    /**
     * Initialize storage
     */
    init() {
        this.migrateData();
        return this;
    },

    /**
     * Migrate old data formats if needed
     */
    migrateData() {
        // Handle any future data migrations here
        const version = localStorage.getItem('epub-reader-version');
        if (!version) {
            localStorage.setItem('epub-reader-version', '1.0');
        }
    },

    /**
     * Get the library of books
     */
    getLibrary() {
        try {
            const data = localStorage.getItem(this.KEYS.LIBRARY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('Failed to load library:', e);
            return [];
        }
    },

    /**
     * Save the library
     */
    saveLibrary(library) {
        try {
            localStorage.setItem(this.KEYS.LIBRARY, JSON.stringify(library));
            return true;
        } catch (e) {
            console.error('Failed to save library:', e);
            return false;
        }
    },

    /**
     * Add a book to the library
     */
    addBook(bookData) {
        const library = this.getLibrary();
        
        // Check if book already exists
        const existingIndex = library.findIndex(b => b.id === bookData.id);
        if (existingIndex >= 0) {
            // Update existing book
            library[existingIndex] = { ...library[existingIndex], ...bookData };
        } else {
            // Add new book
            library.push(bookData);
        }
        
        return this.saveLibrary(library);
    },

    /**
     * Remove a book from the library
     */
    removeBook(bookId) {
        const library = this.getLibrary();
        const filtered = library.filter(b => b.id !== bookId);
        return this.saveLibrary(filtered);
    },

    /**
     * Get a specific book
     */
    getBook(bookId) {
        const library = this.getLibrary();
        return library.find(b => b.id === bookId) || null;
    },

    /**
     * Get reading progress
     */
    getProgress(bookId) {
        try {
            const data = localStorage.getItem(this.KEYS.PROGRESS);
            const progress = data ? JSON.parse(data) : {};
            const result = bookId ? (progress[bookId] || null) : progress;
            if (bookId) {
                console.log(`[PROGRESS GET] Book: ${bookId}, Found: ${result ? `Chapter ${result.chapterIndex}, Word ${result.wordIndex}` : 'NONE'}`);
            }
            return result;
        } catch (e) {
            console.error('Failed to load progress:', e);
            return bookId ? null : {};
        }
    },

    /**
     * Save reading progress
     */
    saveProgress(bookId, chapterIndex, wordIndex) {
        try {
            const progress = this.getProgress();
            progress[bookId] = {
                chapterIndex,
                wordIndex,
                lastRead: Date.now()
            };
            localStorage.setItem(this.KEYS.PROGRESS, JSON.stringify(progress));
            console.log(`[PROGRESS SAVE] Book: ${bookId}, Chapter: ${chapterIndex}, Word: ${wordIndex}`);
            return true;
        } catch (e) {
            console.error('Failed to save progress:', e);
            return false;
        }
    },

    /**
     * Get settings
     */
    getSettings() {
        try {
            const data = localStorage.getItem(this.KEYS.SETTINGS);
            const defaults = {
                theme: 'dark',
                wpm: 300,
                chapterPanelOpen: true,
                lastLoadedBookId: null
            };
            return data ? { ...defaults, ...JSON.parse(data) } : defaults;
        } catch (e) {
            console.error('Failed to load settings:', e);
            return { theme: 'dark', wpm: 300, chapterPanelOpen: true, lastLoadedBookId: null };
        }
    },

    /**
     * Save settings
     */
    saveSettings(settings) {
        try {
            const current = this.getSettings();
            localStorage.setItem(this.KEYS.SETTINGS, JSON.stringify({ ...current, ...settings }));
            return true;
        } catch (e) {
            console.error('Failed to save settings:', e);
            return false;
        }
    },

    /**
     * Clear all data
     */
    clearAll() {
        localStorage.removeItem(this.KEYS.LIBRARY);
        localStorage.removeItem(this.KEYS.PROGRESS);
        localStorage.removeItem(this.KEYS.SETTINGS);
    }
};

// Auto-initialize
StorageManager.init();