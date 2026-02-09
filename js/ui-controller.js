/**
 * UI Controller - Manages all UI interactions and updates
 */

const UIController = {
    // DOM Elements cache
    elements: {},
    
    // State
    currentBook: null,
    currentChapter: null,
    chapterPanelOpen: true,

    /**
     * Initialize UI controller
     */
    init() {
        this.cacheElements();
        this.bindEvents();
        this.loadSettings();
        this.renderLibrary();
        return this;
    },

    /**
     * Cache DOM elements
     */
    cacheElements() {
        this.elements = {
            // Sidebar
            libraryContainer: document.getElementById('libraryContainer'),
            epubUpload: document.getElementById('epubUpload'),
            
            // Top bar
            bookInfo: document.getElementById('bookInfo'),
            themeToggle: document.getElementById('themeToggle'),
            wpmMinus: document.getElementById('wpmMinus'),
            wpmPlus: document.getElementById('wpmPlus'),
            wpmValue: document.getElementById('wpmValue'),
            playPauseBtn: document.getElementById('playPauseBtn'),
            playIcon: document.getElementById('playIcon'),
            
            // Reader
            chapterHeader: document.getElementById('chapterHeader'),
            chapterTitle: document.getElementById('chapterTitle'),
            spritzContainer: document.getElementById('spritzContainer'),
            spritzWord: document.getElementById('spritzWord'),
            chapterToggle: document.getElementById('chapterToggle'),
            chapterPanel: document.getElementById('chapterPanel'),
            chapterContent: document.getElementById('chapterContent'),
            
            // Progress
            progressBar: document.getElementById('progressBar'),
            progressFill: document.getElementById('progressFill'),
            progressText: document.getElementById('progressText'),
            
            // Loading
            loadingOverlay: document.getElementById('loadingOverlay')
        };
    },

    /**
     * Bind event listeners
     */
    bindEvents() {
        const e = this.elements;
        
        // File upload
        e.epubUpload.addEventListener('change', (event) => this.handleFileUpload(event));
        
        // Theme toggle
        e.themeToggle.addEventListener('click', () => {
            ThemeManager.toggle();
        });
        
        // WPM controls
        e.wpmMinus.addEventListener('click', () => this.adjustWPM(-10));
        e.wpmPlus.addEventListener('click', () => this.adjustWPM(10));
        
        // Play/Pause
        e.playPauseBtn.addEventListener('click', () => SpritzEngine.toggle());
        
        // Chapter toggle
        e.chapterToggle.addEventListener('click', () => this.toggleChapterPanel());
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (event) => this.handleKeydown(event));
    },

    /**
     * Load settings
     */
    loadSettings() {
        const settings = StorageManager.getSettings();
        this.chapterPanelOpen = settings.chapterPanelOpen !== false;
        
        // Update WPM display
        this.elements.wpmValue.textContent = settings.wpm || 300;
        
        // Apply chapter panel state
        if (this.chapterPanelOpen) {
            this.elements.chapterPanel.classList.add('expanded');
            this.elements.chapterToggle.classList.add('expanded');
        }
    },

    /**
     * Handle file upload
     */
    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file || !file.name.endsWith('.epub')) {
            alert('Please select a valid EPUB file');
            return;
        }
        
        this.showLoading(true);
        
        try {
            // Parse EPUB
            const bookData = await EpubParser.parse(file);
            
            // Check if we can store full content
            const contentSize = StorageManager.getSize(bookData.chapters);
            const canStoreFull = StorageManager.canStoreFullContent(contentSize);
            
            if (!canStoreFull) {
                console.log('Book too large, storing metadata only');
                // Keep chapters in memory but don't persist them
                const { chapters, ...metadata } = bookData;
                StorageManager.addBook(metadata);
                // Store full data temporarily
                this.currentBook = bookData;
            } else {
                StorageManager.addBook(bookData);
            }
            
            // Refresh library and load book
            this.renderLibrary();
            this.loadBook(bookData.id);
            
            // Reset file input
            event.target.value = '';
            
        } catch (error) {
            console.error('Failed to parse EPUB:', error);
            alert('Failed to parse EPUB: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    },

    /**
     * Render library sidebar
     */
    renderLibrary() {
        const library = StorageManager.getLibrary();
        const container = this.elements.libraryContainer;
        
        if (library.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>No books yet</p>
                    <p class="hint">Upload an EPUB to get started</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = library.map(book => this.renderBookItem(book)).join('');
        
        // Bind book item events
        container.querySelectorAll('.book-header').forEach(header => {
            header.addEventListener('click', (e) => {
                // Don't trigger if delete button clicked
                if (e.target.closest('.delete-book')) return;
                
                const bookId = header.dataset.bookId;
                const bookItem = header.closest('.book-item');
                
                // Toggle expand
                bookItem.classList.toggle('expanded');
                
                // Load book
                this.loadBook(bookId);
            });
        });
        
        // Bind delete buttons
        container.querySelectorAll('.delete-book').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const bookId = btn.dataset.bookId;
                this.deleteBook(bookId);
            });
        });
        
        // Bind chapter clicks
        container.querySelectorAll('.chapter-item').forEach(chapter => {
            chapter.addEventListener('click', () => {
                const bookId = chapter.dataset.bookId;
                const chapterIndex = parseInt(chapter.dataset.chapterIndex);
                
                // Mark as active
                container.querySelectorAll('.chapter-item').forEach(c => c.classList.remove('active'));
                chapter.classList.add('active');
                
                // Load chapter
                this.loadChapter(bookId, chapterIndex);
            });
        });
    },

    /**
     * Render single book item
     */
    renderBookItem(book) {
        const isExpanded = this.currentBook && this.currentBook.id === book.id;
        const isActive = isExpanded ? 'active' : '';
        const expandedClass = isExpanded ? 'expanded' : '';
        
        const coverHtml = book.cover 
            ? `<img src="${book.cover}" alt="Cover">`
            : '📖';
        
        const chaptersHtml = book.spine.map((ch, idx) => `
            <div class="chapter-item" data-book-id="${book.id}" data-chapter-index="${idx}">
                ${ch.title || `Chapter ${idx + 1}`}
            </div>
        `).join('');
        
        return `
            <div class="book-item ${expandedClass}" data-book-id="${book.id}">
                <div class="book-header ${isActive}" data-book-id="${book.id}">
                    <span class="book-toggle">▶</span>
                    <div class="book-cover">${coverHtml}</div>
                    <div class="book-meta">
                        <div class="book-title">${book.title || 'Untitled'}</div>
                        <div class="book-author">${book.author || 'Unknown Author'}</div>
                    </div>
                    <button class="delete-book" data-book-id="${book.id}" title="Remove book">×</button>
                </div>
                <div class="chapter-list">
                    ${chaptersHtml}
                </div>
            </div>
        `;
    },

    /**
     * Load a book
     */
    loadBook(bookId) {
        // Get book data (from memory or storage)
        let book = this.currentBook && this.currentBook.id === bookId 
            ? this.currentBook 
            : StorageManager.getBook(bookId);
        
        if (!book) return;
        
        this.currentBook = book;
        
        // Update book info
        this.elements.bookInfo.innerHTML = `
            <h2>${book.title || 'Untitled'}</h2>
        `;
        
        // Check for saved progress
        const progress = StorageManager.getProgress(bookId);
        const chapterIndex = progress ? progress.chapterIndex : 0;
        
        // Load first or saved chapter
        this.loadChapter(bookId, chapterIndex);
    },

    /**
     * Load a chapter
     */
    loadChapter(bookId, chapterIndex) {
        if (!this.currentBook) return;
        
        const chapter = EpubParser.getChapter(this.currentBook, chapterIndex);
        if (!chapter) return;
        
        this.currentChapter = chapter;
        
        // Update chapter header
        this.elements.chapterTitle.textContent = chapter.title;
        
        // Render chapter content
        this.renderChapterContent(chapter);
        
        // Load words into Spritz engine
        const progress = StorageManager.getProgress(bookId);
        const wordIndex = (progress && progress.chapterIndex === chapterIndex) 
            ? progress.wordIndex 
            : 0;
        
        SpritzEngine.loadWords(chapter.words, wordIndex);
        
        // Update active chapter in sidebar
        this.highlightActiveChapter(bookId, chapterIndex);
        
        // Save progress
        StorageManager.saveProgress(bookId, chapterIndex, wordIndex);
    },

    /**
     * Render chapter content in panel
     */
    renderChapterContent(chapter) {
        const content = this.elements.chapterContent;
        
        if (!chapter.words || chapter.words.length === 0) {
            content.innerHTML = '<p class="placeholder-text">No content available</p>';
            return;
        }
        
        // Create HTML with each word wrapped in span
        const wordsHtml = chapter.words.map((word, idx) => 
            `<span class="word" data-index="${idx}">${this.escapeHtml(word)}</span>`
        ).join(' ');
        
        content.innerHTML = `<p>${wordsHtml}</p>`;
        
        // Make words clickable
        content.querySelectorAll('.word').forEach(wordEl => {
            wordEl.addEventListener('click', () => {
                const index = parseInt(wordEl.dataset.index);
                SpritzEngine.jumpTo(index);
            });
        });
    },

    /**
     * Update word display in Spritz
     */
    updateSpritzWord(data) {
        const { formatted, isNewChapter } = data;
        const container = this.elements.spritzWord;
        const placeholder = this.elements.spritzContainer.querySelector('.spritz-placeholder');
        
        // Hide placeholder, show word
        if (placeholder) {
            placeholder.style.display = 'none';
        }
        container.style.display = 'flex';
        
        // Update word parts
        container.querySelector('.word-left').textContent = formatted.left;
        container.querySelector('.word-center').textContent = formatted.center;
        container.querySelector('.word-right').textContent = formatted.right;
        
        // Handle new chapter indicator
        if (isNewChapter) {
            container.classList.add('new-chapter');
            setTimeout(() => {
                container.classList.remove('new-chapter');
            }, 3000);
        }
    },

    /**
     * Highlight active word in chapter panel
     */
    highlightWordInPanel(index) {
        const content = this.elements.chapterContent;
        const words = content.querySelectorAll('.word');
        
        words.forEach((word, idx) => {
            if (idx === index) {
                word.classList.add('active');
                word.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                word.classList.remove('active');
            }
        });
    },

    /**
     * Update progress bar
     */
    updateProgress(percentage) {
        this.elements.progressFill.style.width = percentage + '%';
        this.elements.progressText.textContent = Math.round(percentage) + '%';
    },

    /**
     * Update play/pause button
     */
    updatePlayButton(isPlaying) {
        this.elements.playIcon.textContent = isPlaying ? '⏸' : '▶';
    },

    /**
     * Toggle chapter panel
     */
    toggleChapterPanel() {
        this.chapterPanelOpen = !this.chapterPanelOpen;
        
        if (this.chapterPanelOpen) {
            this.elements.chapterPanel.classList.add('expanded');
            this.elements.chapterToggle.classList.add('expanded');
            this.elements.chapterToggle.querySelector('span').textContent = 'Hide Chapter Text';
        } else {
            this.elements.chapterPanel.classList.remove('expanded');
            this.elements.chapterToggle.classList.remove('expanded');
            this.elements.chapterToggle.querySelector('span').textContent = 'Show Chapter Text';
        }
        
        StorageManager.saveSettings({ chapterPanelOpen: this.chapterPanelOpen });
    },

    /**
     * Adjust WPM
     */
    adjustWPM(delta) {
        const newWPM = SpritzEngine.getWPM() + delta;
        const clampedWPM = Math.max(50, Math.min(1000, newWPM));
        
        SpritzEngine.setWPM(clampedWPM);
        this.elements.wpmValue.textContent = clampedWPM;
    },

    /**
     * Handle keyboard shortcuts
     */
    handleKeydown(event) {
        // Don't trigger if user is typing in an input
        if (event.target.tagName === 'INPUT') return;
        
        switch (event.code) {
            case 'Space':
                event.preventDefault();
                SpritzEngine.toggle();
                break;
            case 'ArrowLeft':
                event.preventDefault();
                SpritzEngine.previous();
                break;
            case 'ArrowRight':
                event.preventDefault();
                SpritzEngine.next();
                break;
            case 'ArrowUp':
                event.preventDefault();
                this.adjustWPM(10);
                break;
            case 'ArrowDown':
                event.preventDefault();
                this.adjustWPM(-10);
                break;
        }
    },

    /**
     * Highlight active chapter in sidebar
     */
    highlightActiveChapter(bookId, chapterIndex) {
        const container = this.elements.libraryContainer;
        
        // Remove all active classes
        container.querySelectorAll('.chapter-item').forEach(c => {
            c.classList.remove('active', 'reading');
        });
        
        // Add active to current
        const activeChapter = container.querySelector(
            `.chapter-item[data-book-id="${bookId}"][data-chapter-index="${chapterIndex}"]`
        );
        if (activeChapter) {
            activeChapter.classList.add('active', 'reading');
        }
    },

    /**
     * Delete a book
     */
    deleteBook(bookId) {
        if (!confirm('Remove this book from your library?')) return;
        
        StorageManager.removeBook(bookId);
        
        if (this.currentBook && this.currentBook.id === bookId) {
            this.currentBook = null;
            this.currentChapter = null;
            SpritzEngine.pause();
            this.resetReader();
        }
        
        this.renderLibrary();
    },

    /**
     * Reset reader to initial state
     */
    resetReader() {
        this.elements.bookInfo.innerHTML = '<span class="no-book">Select a book to start reading</span>';
        this.elements.chapterTitle.textContent = 'Select a chapter';
        this.elements.chapterContent.innerHTML = '<p class="placeholder-text">Chapter text will appear here...</p>';
        this.elements.spritzWord.style.display = 'none';
        this.elements.spritzContainer.querySelector('.spritz-placeholder').style.display = 'block';
        this.updateProgress(0);
    },

    /**
     * Show/hide loading overlay
     */
    showLoading(show) {
        this.elements.loadingOverlay.hidden = !show;
    },

    /**
     * Handle chapter end
     */
    handleChapterEnd() {
        if (!this.currentBook || !this.currentChapter) return;
        
        const nextIndex = this.currentChapter.index + 1;
        
        if (nextIndex < this.currentChapter.totalChapters) {
            // Mark new chapter transition
            SpritzEngine.markNewChapter();
            
            // Small delay then load next chapter
            setTimeout(() => {
                this.loadChapter(this.currentBook.id, nextIndex);
                SpritzEngine.play();
            }, 100);
        }
    },

    /**
     * Escape HTML special characters
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};