/**
 * Storage Manager - IndexedDB backend for library, progress, and settings.
 * Supports multiple books and large book sizes (no practical limit).
 */

const StorageManager = {
    DB_NAME: 'EpubReaderDB',
    DB_VERSION: 1,
    STORES: { BOOKS: 'books', PROGRESS: 'progress', SETTINGS: 'settings' },
    SETTINGS_KEY: 'default',

    _db: null,
    _settingsCache: null,

    /**
     * Initialize storage and open IndexedDB. Call once at app startup.
     * @returns {Promise<void>}
     */
    async init() {
        if (this._db) return;
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
                this._db = req.result;
                this._migrateFromLocalStorage().then(() => this._loadSettingsCache()).then(resolve).catch(reject);
            };
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.STORES.BOOKS)) {
                    db.createObjectStore(this.STORES.BOOKS, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(this.STORES.PROGRESS)) {
                    db.createObjectStore(this.STORES.PROGRESS, { keyPath: 'bookId' });
                }
                if (!db.objectStoreNames.contains(this.STORES.SETTINGS)) {
                    db.createObjectStore(this.STORES.SETTINGS, { keyPath: 'id' });
                }
            };
        });
    },

    /**
     * Load settings into memory for sync getSettings()
     * @private
     */
    async _loadSettingsCache() {
        const raw = await this._get(this.STORES.SETTINGS, this.SETTINGS_KEY);
        const defaults = {
            theme: 'dark',
            wpm: 300,
            fontSize: 96,
            orpColor: '#1c71d8',
            chapterPanelOpen: true,
            lastLoadedBookId: null
        };
        this._settingsCache = raw ? { ...defaults, ...raw } : defaults;
    },

    /**
     * One-time migration from localStorage to IndexedDB
     * @private
     */
    async _migrateFromLocalStorage() {
        const libraryJson = localStorage.getItem('epub-library');
        if (!libraryJson) return;

        try {
            const library = JSON.parse(libraryJson);
            for (const book of library) {
                await this._put(this.STORES.BOOKS, book);
            }
        } catch (e) {
            console.warn('Migration of library from localStorage failed:', e);
        }

        try {
            const progressJson = localStorage.getItem('epub-progress');
            if (progressJson) {
                const progress = JSON.parse(progressJson);
                for (const [bookId, data] of Object.entries(progress)) {
                    await this._put(this.STORES.PROGRESS, { bookId, ...data });
                }
            }
        } catch (e) {
            console.warn('Migration of progress from localStorage failed:', e);
        }

        try {
            const settingsJson = localStorage.getItem('epub-settings');
            if (settingsJson) {
                const settings = JSON.parse(settingsJson);
                await this._put(this.STORES.SETTINGS, { id: this.SETTINGS_KEY, ...settings });
            }
        } catch (e) {
            console.warn('Migration of settings from localStorage failed:', e);
        }

        localStorage.removeItem('epub-library');
        localStorage.removeItem('epub-progress');
        localStorage.removeItem('epub-settings');
        console.log('[Storage] Migrated data from localStorage to IndexedDB');
    },

    _get(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    _put(storeName, value) {
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.put(value);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },

    _delete(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },

    _getAll(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    },

    /**
     * Get the library of books (all stored books).
     * @returns {Promise<Array>}
     */
    async getLibrary() {
        try {
            const list = await this._getAll(this.STORES.BOOKS);
            return Array.isArray(list) ? list : [];
        } catch (e) {
            console.error('Failed to load library:', e);
            return [];
        }
    },

    /**
     * Save the library (replace entire library). Prefer addBook/removeBook.
     * @param {Array} library
     * @returns {Promise<boolean>}
     */
    async saveLibrary(library) {
        try {
            const tx = this._db.transaction(this.STORES.BOOKS, 'readwrite');
            const store = tx.objectStore(this.STORES.BOOKS);
            store.clear();
            for (const book of library) {
                store.put(book);
            }
            await new Promise((resolve, reject) => {
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
            return true;
        } catch (e) {
            console.error('Failed to save library:', e);
            return false;
        }
    },

    /**
     * Add or update a book.
     * @param {Object} bookData Full book object (id, title, author, chapters, toc, etc.)
     * @returns {Promise<boolean>}
     */
    async addBook(bookData) {
        try {
            const existing = await this._get(this.STORES.BOOKS, bookData.id);
            const merged = existing ? { ...existing, ...bookData } : bookData;
            await this._put(this.STORES.BOOKS, merged);
            return true;
        } catch (e) {
            console.error('Failed to add book:', e);
            return false;
        }
    },

    /**
     * Remove a book and its progress.
     * @param {string} bookId
     * @returns {Promise<boolean>}
     */
    async removeBook(bookId) {
        try {
            await this._delete(this.STORES.BOOKS, bookId);
            await this._delete(this.STORES.PROGRESS, bookId);
            return true;
        } catch (e) {
            console.error('Failed to remove book:', e);
            return false;
        }
    },

    /**
     * Get a specific book by id.
     * @param {string} bookId
     * @returns {Promise<Object|null>}
     */
    async getBook(bookId) {
        try {
            const book = await this._get(this.STORES.BOOKS, bookId);
            return book || null;
        } catch (e) {
            console.error('Failed to load book:', e);
            return null;
        }
    },

    /**
     * Get reading progress for one book or all.
     * @param {string} [bookId] If omitted, returns all progress.
     * @returns {Promise<Object|null|Object>}
     */
    async getProgress(bookId) {
        try {
            if (bookId) {
                const row = await this._get(this.STORES.PROGRESS, bookId);
                return row ? { chapterIndex: row.chapterIndex, wordIndex: row.wordIndex, lastRead: row.lastRead } : null;
            }
            const all = await this._getAll(this.STORES.PROGRESS);
            const out = {};
            for (const row of all) {
                out[row.bookId] = { chapterIndex: row.chapterIndex, wordIndex: row.wordIndex, lastRead: row.lastRead };
            }
            return out;
        } catch (e) {
            console.error('Failed to load progress:', e);
            return bookId ? null : {};
        }
    },

    /**
     * Save reading progress for a book.
     * @param {string} bookId
     * @param {number} chapterIndex
     * @param {number} wordIndex
     * @returns {Promise<boolean>}
     */
    async saveProgress(bookId, chapterIndex, wordIndex) {
        try {
            await this._put(this.STORES.PROGRESS, {
                bookId,
                chapterIndex,
                wordIndex,
                lastRead: Date.now()
            });
            return true;
        } catch (e) {
            console.error('Failed to save progress:', e);
            return false;
        }
    },

    /**
     * Get settings (sync, from in-memory cache after init).
     */
    getSettings() {
        const defaults = {
            theme: 'dark',
            wpm: 300,
            fontSize: 96,
            orpColor: '#1c71d8',
            chapterPanelOpen: true,
            lastLoadedBookId: null
        };
        return this._settingsCache ? { ...defaults, ...this._settingsCache } : defaults;
    },

    /**
     * Save settings (updates cache immediately, persists to IndexedDB).
     * @param {Object} settings
     * @returns {Promise<boolean>}
     */
    async saveSettings(settings) {
        const current = this.getSettings();
        const merged = { ...current, ...settings };
        this._settingsCache = merged;
        try {
            await this._put(this.STORES.SETTINGS, { id: this.SETTINGS_KEY, ...merged });
            return true;
        } catch (e) {
            console.error('Failed to save settings:', e);
            return false;
        }
    },

    /**
     * Clear all data (books, progress, settings).
     * @returns {Promise<void>}
     */
    async clearAll() {
        const tx = this._db.transaction([this.STORES.BOOKS, this.STORES.PROGRESS, this.STORES.SETTINGS], 'readwrite');
        tx.objectStore(this.STORES.BOOKS).clear();
        tx.objectStore(this.STORES.PROGRESS).clear();
        tx.objectStore(this.STORES.SETTINGS).clear();
        await new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        this._settingsCache = { theme: 'dark', wpm: 300, fontSize: 96, orpColor: '#1c71d8', chapterPanelOpen: true, lastLoadedBookId: null };
    }
};
