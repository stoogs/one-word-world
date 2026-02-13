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
    expandedBookId: null, // Track which book is expanded in sidebar
    expandedSections: new Set(), // Track expanded sections by ID
    isZenMode: false, // Track zen mode state
    /** Full book objects (with chapters) per id – keeps sidebar chapters when switching books */
    bookCache: {},

    /**
     * Initialize UI controller (async - loads library and last book from IndexedDB)
     */
    async init() {
        this.cacheElements();
        this.bindEvents();
        this.loadSettings();

        await this.validateState();
        await this.renderLibrary();

        const settings = StorageManager.getSettings();
        if (settings.lastLoadedBookId) {
            const lastBook = await StorageManager.getBook(settings.lastLoadedBookId);
            if (lastBook) {
                if (lastBook.chapters && lastBook.chapters.length) {
                    this.bookCache[lastBook.id] = lastBook;
                }
                console.log(`Auto-loading last book: ${lastBook.title}`);
                this.expandedBookId = lastBook.id;
                await this.loadBook(lastBook.id);
            }
        }

        await this.validateState();
        await this.renderLibrary();

        document.addEventListener('fullscreenchange', () => {
            if (!document.fullscreenElement && this.isZenMode) {
                console.log('[ZEN MODE] Fullscreen exited, leaving zen mode');
                this.exitZenMode();
            }
        });

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
            orpColorPicker: document.getElementById('orpColorPicker'),
            textColorPicker: document.getElementById('textColorPicker'),
            fontSizeMinus: document.getElementById('fontSizeMinus'),
            fontSizePlus: document.getElementById('fontSizePlus'),
            fontSizeValue: document.getElementById('fontSizeValue'),
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
            const newTheme = ThemeManager.toggle();
            // Always reset text color to theme default
            this.applyThemeTextColor(newTheme);
        });

        // Color pickers
        e.orpColorPicker.addEventListener('input', (event) => this.changeORPColor(event.target.value));
        e.textColorPicker.addEventListener('input', (event) => this.changeTextColor(event.target.value));
        
        // Text color picker click - always set theme default
        e.textColorPicker.addEventListener('click', () => {
            const isDark = ThemeManager.isDark();
            const defaultColor = isDark ? '#deddda' : '#241f31';
            this.elements.textColorPicker.value = defaultColor;
            this.changeTextColor(defaultColor);
        });

        // Font size controls
        e.fontSizeMinus.addEventListener('click', () => this.adjustFontSize(-4));
        e.fontSizePlus.addEventListener('click', () => this.adjustFontSize(4));
        
        // WPM controls
        e.wpmMinus.addEventListener('click', () => this.adjustWPM(-10));
        e.wpmPlus.addEventListener('click', () => this.adjustWPM(10));
        
        // Play/Pause
        e.playPauseBtn.addEventListener('click', () => SpritzEngine.toggle());
        
        // Chapter toggle
        e.chapterToggle.addEventListener('click', () => this.toggleChapterPanel());
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (event) => this.handleKeydown(event));
        
        // Delegate events for dynamic content
        e.libraryContainer.addEventListener('click', (e) => this.handleLibraryClick(e));
    },

    /**
     * Handle clicks in library container (event delegation)
     */
    async handleLibraryClick(event) {
        // Handle section toggle
        const sectionHeader = event.target.closest('.section-header');
        if (sectionHeader) {
            const bookId = sectionHeader.dataset.bookId;
            const sectionId = sectionHeader.dataset.sectionId;
            await this.toggleSection(bookId, sectionId, sectionHeader);
            return;
        }

        // Handle chapter click
        const chapterItem = event.target.closest('.chapter-item');
        if (chapterItem) {
            const bookId = chapterItem.dataset.bookId;
            const chapterIndex = parseInt(chapterItem.dataset.chapterIndex, 10);
            const anchor = chapterItem.dataset.anchor || '';
            const tocTitle = chapterItem.dataset.tocTitle || '';
            // Ensure the book is loaded so we have full chapter data (fixes wrong chapter text when switching)
            if (!this.currentBook || this.currentBook.id !== bookId) {
                await this.loadBook(bookId);
            }
            await this.loadChapter(bookId, chapterIndex, anchor, tocTitle);
            return;
        }

        // Handle Remove button (current book only)
        const unloadBtn = event.target.closest('.unload-book-btn');
        if (unloadBtn) {
            event.stopPropagation();
            await this.unloadBook();
            return;
        }

        // Handle book header click: load book and expand chapters (or toggle chapters if same book)
        const bookHeader = event.target.closest('.book-header');
        if (bookHeader) {
            const bookId = bookHeader.dataset.bookId;
            if (this.currentBook && this.currentBook.id === bookId) {
                this.toggleBookExpansion(bookId);
            } else {
                this.expandedBookId = bookId;
                await this.loadBook(bookId);
            }
            return;
        }
    },

    /**
     * Toggle book expansion in sidebar
     */
    toggleBookExpansion(bookId) {
        // Collapse current expanded book
        if (this.expandedBookId && this.expandedBookId !== bookId) {
            const currentExpanded = document.querySelector(`.book-item[data-book-id="${this.expandedBookId}"]`);
            if (currentExpanded) {
                currentExpanded.classList.remove('expanded');
            }
        }
        
        // Toggle the clicked book
        const bookItem = document.querySelector(`.book-item[data-book-id="${bookId}"]`);
        if (bookItem) {
            const isExpanded = bookItem.classList.contains('expanded');
            if (isExpanded) {
                bookItem.classList.remove('expanded');
                this.expandedBookId = null;
            } else {
                bookItem.classList.add('expanded');
                this.expandedBookId = bookId;
            }
        }
    },

    /**
     * Unload and remove current book from storage
     */
    async unloadBook() {
        if (!this.currentBook) return;

        const bookTitle = this.currentBook.title || 'Untitled';

        // Show confirmation dialog
        if (!confirm(`Remove "${bookTitle}" from storage?\n\nProgress will be saved. You can re-upload the EPUB file later to resume reading.`)) {
            return;
        }

        // Save progress before removing
        if (this.currentChapter) {
            const position = SpritzEngine.getPosition ? SpritzEngine.getPosition() : { index: 0 };
            console.log(`[UNLOAD] Saving final progress - Chapter: ${this.currentChapter.index}, Word: ${position.index}`);
            await StorageManager.saveProgress(this.currentBook.id, this.currentChapter.index, position.index || 0);
        }

        // Remove book from storage
        await StorageManager.removeBook(this.currentBook.id);

        const removedId = this.currentBook.id;
        this.currentBook = null;
        this.currentChapter = null;
        this.expandedBookId = null;
        delete this.bookCache[removedId];

        // Stop playback
        SpritzEngine.pause();
        SpritzEngine.loadWords([], 0);

        // Reset UI
        this.resetReader();

        StorageManager.saveSettings({ lastLoadedBookId: null });

        await this.renderLibrary();

        console.log(`Book "${bookTitle}" removed from storage`);
    },

    /**
     * Load settings
     */
    loadSettings() {
        const settings = StorageManager.getSettings();
        this.chapterPanelOpen = settings.chapterPanelOpen !== false;

        // Update WPM display and engine
        const savedWPM = settings.wpm || 300;
        this.elements.wpmValue.textContent = savedWPM;
        SpritzEngine.setWPM(savedWPM);

        // Update font size display and apply
        const savedFontSize = settings.fontSize || 96;
        this.elements.fontSizeValue.textContent = savedFontSize;
        const spritzWord = document.getElementById('spritzWord');
        if (spritzWord) {
            spritzWord.style.fontSize = savedFontSize + 'px';
        }

        // Load and apply saved colors
        const savedORPColor = settings.orpColor || '#1c71d8';
        this.elements.orpColorPicker.value = savedORPColor;
        
        // Apply theme-appropriate text color
        const currentTheme = ThemeManager.getCurrent();
        const savedTextColor = currentTheme === 'dark' ? '#deddda' : '#241f31';
        this.elements.textColorPicker.value = savedTextColor;
        this.applyColors(savedORPColor, savedTextColor);

        // Apply chapter panel state
        if (this.chapterPanelOpen) {
            this.elements.chapterPanel.classList.add('expanded');
            this.elements.chapterToggle.classList.add('expanded');
        }
    },

    /**
     * Change ORP (middle letter) color
     */
    changeORPColor(color) {
        // Set on body to override theme-specific values
        document.body.style.setProperty('--orp', color);
        StorageManager.saveSettings({ orpColor: color });
    },

    /**
     * Change text (side letters) color
     */
    changeTextColor(color) {
        // Apply color directly to word side elements
        this.applyTextColor(color);
    },

    /**
     * Apply theme-appropriate text color
     */
    applyThemeTextColor(theme) {
        const defaultColor = theme === 'dark' ? '#deddda' : '#241f31';
        this.elements.textColorPicker.value = defaultColor;
        this.applyTextColor(defaultColor);
    },

    /**
     * Apply text color to side letter elements
     */
    applyTextColor(color) {
        // Find all word-left and word-right elements and set inline style
        const leftSpans = document.querySelectorAll('.word-left');
        const rightSpans = document.querySelectorAll('.word-right');

        leftSpans.forEach(el => el.style.color = color);
        rightSpans.forEach(el => el.style.color = color);
    },

    /**
     * Apply both colors
     */
    applyColors(orpColor, textColor) {
        // Apply ORP color (middle letter) via CSS variable on body
        // This overrides theme-specific values since body has higher specificity
        document.body.style.setProperty('--orp', orpColor);

        // Apply text color (side letters) directly to elements
        this.applyTextColor(textColor);
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
            
            console.log(`Parsed "${bookData.title}" with ${bookData.chapters.length} chapters`);
            
            // Save book to IndexedDB (no size limit)
            const saved = await StorageManager.addBook(bookData);

            if (!saved) {
                console.error('Failed to save book');
                alert('Failed to save book to storage. Please try again.');
                return;
            }

            console.log('Book saved successfully');

            this.bookCache[bookData.id] = bookData;
            this.expandedBookId = bookData.id;
            await this.renderLibrary();
            await this.loadBook(bookData.id);
            
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
     * Validate state against current library (fix expanded/current if books were removed).
     * Call before every library render. Returns the library array to use for rendering.
     */
    async validateState() {
        const library = await StorageManager.getLibrary();
        const ids = new Set(library.map(b => b.id));

        if (this.expandedBookId && !ids.has(this.expandedBookId)) {
            this.expandedBookId = null;
        }
        if (this.currentBook && !ids.has(this.currentBook.id)) {
            this.currentBook = null;
            this.currentChapter = null;
            SpritzEngine.pause();
            SpritzEngine.loadWords([], 0);
            this.resetReader();
            StorageManager.saveSettings({ lastLoadedBookId: null });
        }

        return library;
    },

    /**
     * Render library sidebar (async). Validates state first, then renders from IndexedDB.
     */
    async renderLibrary() {
        const library = await this.validateState();
        const container = this.elements.libraryContainer;

        if (!container) return;

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
    },

    /**
     * Render single book item - compact view with load/unload.
     * Prefers bookCache (full book with chapters) so chapters stay visible when switching books.
     */
    renderBookItem(book) {
        const id = book.id;
        if (this.bookCache[id] && this.bookCache[id].chapters && this.bookCache[id].chapters.length) {
            book = this.bookCache[id];
        } else if (this.currentBook && this.currentBook.id === id) {
            book = this.currentBook;
        }
        const isLoaded = this.currentBook && this.currentBook.id === book.id;
        const isExpanded = this.expandedBookId === book.id;
        const expandedClass = isExpanded ? 'expanded' : '';
        const loadedClass = isLoaded ? 'loaded' : '';

        const coverHtml = book.cover 
            ? `<img src="${book.cover}" alt="Cover">`
            : '📖';

        const removeButton = isLoaded
            ? `<button class="unload-book-btn" data-book-id="${book.id}" title="Remove from library">Remove</button>`
            : '';

        // Render TOC when expanded: use hierarchical TOC only if it covers most chapters; otherwise full list
        let tocHtml = '';
        if (isExpanded && book.chapters && book.chapters.length > 0) {
            const tocChapterCount = book.toc && book.toc.length > 0
                ? this.countTOCChapters(book.toc, book.chapters)
                : 0;
            const useTOC = tocChapterCount >= book.chapters.length * 0.5 ||
                (tocChapterCount > 0 && tocChapterCount > book.chapters.length);
            if (book.toc && book.toc.length > 0 && useTOC) {
                tocHtml = this.renderTOCTree(book.toc, book.id, book.chapters);
            }
            if (!tocHtml) {
                tocHtml = this.renderFallbackChapterList(book.chapters, book.id);
            }
        }

        return `
            <div class="book-item ${expandedClass} ${loadedClass}" data-book-id="${book.id}">
                <div class="book-header" data-book-id="${book.id}">
                    <span class="book-toggle">▶</span>
                    <div class="book-cover">${coverHtml}</div>
                    <div class="book-meta">
                        <div class="book-title">${book.title || 'Untitled'}</div>
                        <div class="book-author">${book.author || 'Unknown Author'}</div>
                    </div>
                    <div class="book-actions">
                        ${removeButton}
                    </div>
                </div>
                <div class="toc-tree">
                    ${tocHtml}
                </div>
            </div>
        `;
    },

    /**
     * Count how many chapters the TOC tree would show (leaf entries that match a chapter).
     * Used to detect sparse TOC (e.g. only "Contents" / parts) so we can show full chapter list instead.
     */
    countTOCChapters(items, chapters) {
        if (!items || !items.length || !chapters || !chapters.length) return 0;
        let count = 0;
        for (const item of items) {
            if (item.type === 'section' && item.children && item.children.length > 0) {
                count += this.countTOCChapters(item.children, chapters);
            } else {
                if (EpubParser.findChapterIndexByHref(chapters, item.href) !== -1) count++;
            }
        }
        return count;
    },

    /**
     * Render TOC tree recursively
     */
    renderTOCTree(items, bookId, chapters, renderedEntries = new Set()) {
        if (!items || items.length === 0) return '';

        return items.map(item => {
            if (item.type === 'section' && item.children && item.children.length > 0) {
                // Find first chapter in this section for auto-load
                const firstChapterIndex = this.findFirstChapterInSection(item, chapters);
                
                return `
                    <div class="toc-section">
                        <div class="section-header" 
                             data-book-id="${bookId}" 
                             data-section-id="${item.id}"
                             data-first-chapter="${firstChapterIndex}">
                            <span class="section-toggle">▶</span>
                            <span class="section-title">${this.escapeHtml(item.title || 'Part')}</span>
                        </div>
                        <div class="section-children">
                            ${this.renderTOCTree(item.children, bookId, chapters, renderedEntries)}
                        </div>
                    </div>
                `;
            } else {
                // Regular item or leaf node - find matching chapter
                const chapterIndex = EpubParser.findChapterIndexByHref(chapters, item.href);
                if (chapterIndex === -1) return '';
                
                // Extract anchor from href (e.g., "file.html#section1" -> "section1")
                const anchor = item.href ? item.href.split('#')[1] || '' : '';
                const tocTitle = item.title || chapters[chapterIndex].title || '';
                
                // Track rendered chapters by chapterIndex + title combo to allow multiple sections per file
                const entryKey = `${chapterIndex}:${tocTitle}`;
                if (renderedEntries.has(entryKey)) {
                    // Already rendered this exact entry, skip
                    return '';
                }
                renderedEntries.add(entryKey);
                
                const chapter = chapters[chapterIndex];
                // Smart title formatting: if TOC title already has chapter numbering, use it directly
                // Otherwise prefix with sequential display number
                const hasChapterNumber = /^\s*(chapter|ch\.?|part|section|book)\s*\d+/i.test(tocTitle);
                const title = hasChapterNumber ? tocTitle : (chapter.displayNumber + (tocTitle ? '' + tocTitle : ''));
                const preview = chapter.preview || '';
                return `
                    <div class="chapter-item" 
                         data-book-id="${bookId}" 
                         data-chapter-index="${chapterIndex}"
                         data-anchor="${anchor}"
                         data-toc-title="${this.escapeHtml(tocTitle)}">
                        <div class="chapter-title">${this.escapeHtml(title)}</div>
                        ${preview ? `<div class="chapter-preview">${this.escapeHtml(preview)}</div>` : ''}
                    </div>
                `;
            }
        }).join('');
    },

    /**
     * Render a flat list of chapters when TOC is missing or doesn't match (spine order)
     */
    renderFallbackChapterList(chapters, bookId) {
        if (!chapters || !chapters.length) return '';
        return chapters.map((chapter, index) => {
            const title = chapter.title || `Chapter ${index + 1}`;
            const preview = chapter.preview || '';
            return `
                <div class="chapter-item"
                     data-book-id="${bookId}"
                     data-chapter-index="${index}"
                     data-anchor=""
                     data-toc-title="${this.escapeHtml(title)}">
                    <div class="chapter-title">${this.escapeHtml(title)}</div>
                    ${preview ? `<div class="chapter-preview">${this.escapeHtml(preview)}</div>` : ''}
                </div>
            `;
        }).join('');
    },

    /**
     * Find first readable chapter in a section
     */
    findFirstChapterInSection(section, chapters) {
        if (!section.children) return -1;
        
        for (const child of section.children) {
            if (child.type === 'section') {
                const nestedIndex = this.findFirstChapterInSection(child, chapters);
                if (nestedIndex !== -1) return nestedIndex;
            } else {
                const index = EpubParser.findChapterIndexByHref(chapters, child.href);
                if (index !== -1) return index;
            }
        }
        
        return -1;
    },

    /**
     * Toggle section expansion and auto-load first chapter
     */
    async toggleSection(bookId, sectionId, sectionHeader) {
        const section = sectionHeader.closest('.toc-section');
        const children = section.querySelector('.section-children');
        const isExpanded = section.classList.contains('expanded');

        if (isExpanded) {
            section.classList.remove('expanded');
            children.style.maxHeight = '0';
        } else {
            section.classList.add('expanded');
            children.style.maxHeight = children.scrollHeight + 'px';

            // Auto-load first chapter in section
            const firstChapterIndex = sectionHeader.dataset.firstChapter;
            if (firstChapterIndex && firstChapterIndex !== '-1') {
                await this.loadChapter(bookId, parseInt(firstChapterIndex));
            }
        }
    },

    /**
     * Load a book into the reader (async). Expands this book's chapters and collapses others.
     */
    async loadBook(bookId) {
        console.log(`[LOAD BOOK] Starting load for book ID: ${bookId}`);

        this.expandedBookId = bookId;

        let book = this.currentBook && this.currentBook.id === bookId
            ? this.currentBook
            : await StorageManager.getBook(bookId);

        if (!book) {
            console.log(`[LOAD BOOK] Book not found: ${bookId}`);
            return;
        }

        const hasChapters = book.chapters && book.chapters.length > 0;
        if (!hasChapters && this.bookCache[bookId]?.chapters?.length) {
            book = this.bookCache[bookId];
        }
        if (book.chapters && book.chapters.length > 0) {
            this.bookCache[bookId] = book;
        }

        console.log(`[LOAD BOOK] Book found: "${book.title}" (chapters: ${book.chapters?.length ?? 0})`);
        this.currentBook = book;

        // Update book info
        this.elements.bookInfo.innerHTML = `
            <h2>${book.title || 'Untitled'}</h2>
        `;

        // Check for saved progress
        const progress = await StorageManager.getProgress(bookId);
        console.log(`[LOAD BOOK] Progress check result:`, progress);
        const chapterIndex = progress ? progress.chapterIndex : 0;
        const wordIndex = progress ? progress.wordIndex : 0;

        console.log(`[LOAD BOOK] Loading chapter ${chapterIndex} at word ${wordIndex}`);

        StorageManager.saveSettings({ lastLoadedBookId: bookId });

        await this.renderLibrary();

        await this.loadChapter(bookId, chapterIndex, '', '');
    },

    /**
     * Load a chapter
     * @param {string} bookId - Book ID
     * @param {number} chapterIndex - Chapter index
     * @param {string} anchor - Optional anchor/fragment to jump to within chapter
     * @param {string} tocTitle - Optional TOC title override
     */
    async loadChapter(bookId, chapterIndex, anchor = '', tocTitle = '') {
        if (!this.currentBook) return;

        const chapter = EpubParser.getChapter(this.currentBook, chapterIndex);
        if (!chapter) return;

        this.currentChapter = chapter;

        // Use tocTitle if provided, otherwise fall back to chapter title
        const displayTitle = tocTitle || chapter.title || '';
        // Smart title formatting: if title already has chapter numbering, use it directly
        const hasChapterNumber = /^\s*(chapter|ch\.?|part|section|book)\s*\d+/i.test(displayTitle);
        const title = hasChapterNumber ? displayTitle : (chapter.displayNumber + (displayTitle ? '' + displayTitle : ''));
        const preview = chapter.preview || '';

        this.elements.chapterTitle.innerHTML = `
            <div class="chapter-title-line">${this.escapeHtml(title)}</div>
            ${preview ? `<div class="chapter-preview-line">${this.escapeHtml(preview)}</div>` : ''}
        `;

        // Render chapter content
        this.renderChapterContent(chapter);

        // Calculate starting word position
        let wordIndex = 0;

        if (anchor) {
            // Find word position for this anchor
            wordIndex = this.findWordIndexForAnchor(chapter, anchor);
            console.log(`[LOAD CHAPTER] Anchor "${anchor}" found at word index ${wordIndex}`);
        } else {
            // Use saved progress or start from beginning
            const progress = await StorageManager.getProgress(bookId);
            console.log(`[LOAD CHAPTER] Checking progress for chapter ${chapterIndex}:`, progress);
            if (progress && progress.chapterIndex === chapterIndex) {
                wordIndex = progress.wordIndex;
                console.log(`[LOAD CHAPTER] Restoring saved word position: ${wordIndex}`);
            } else {
                console.log(`[LOAD CHAPTER] No saved progress for this chapter, starting from word 0`);
            }
        }

        // Ensure wordIndex is valid
        wordIndex = Math.max(0, Math.min(wordIndex, chapter.words.length - 1));

        console.log(`[LOAD CHAPTER] Loading ${chapter.words.length} words starting at index ${wordIndex}`);
        SpritzEngine.loadWords(chapter.words, wordIndex);

        // Update active chapter in sidebar
        this.highlightActiveChapter(bookId, chapterIndex, anchor);

        // Expand sections containing this chapter
        this.expandSectionsForChapter(bookId, chapterIndex);

        // Save progress (fire-and-forget)
        StorageManager.saveProgress(bookId, chapterIndex, wordIndex);
    },

    /**
     * Find the word index for a given anchor within chapter content
     * @param {Object} chapter - Chapter object with content and words
     * @param {string} anchor - Anchor ID to find
     * @returns {number} Word index where anchor appears
     */
    findWordIndexForAnchor(chapter, anchor) {
        if (!chapter.content || !anchor) return 0;

        try {
            const { doc, body } = EpubParser.parseContentDocument(chapter.content);
            if (!doc || !body) return 0;

            const element = doc.getElementById(anchor) ||
                doc.querySelector(`[name="${anchor}"]`) ||
                doc.querySelector(`a[name="${anchor}"]`);

            if (!element) {
                console.log(`Anchor "${anchor}" not found in chapter`);
                return 0;
            }

            const walker = document.createTreeWalker(
                body,
                NodeFilter.SHOW_TEXT,
                null,
                false
            );

            let textUpToAndIncludingAnchor = '';
            let pastAnchor = false;

            while (walker.nextNode()) {
                const node = walker.currentNode;
                if (element.contains(node)) {
                    textUpToAndIncludingAnchor += node.textContent;
                    pastAnchor = true;
                } else if (pastAnchor) {
                    break;
                } else if (element.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) {
                    textUpToAndIncludingAnchor += node.textContent;
                }
            }

            const wordsBefore = textUpToAndIncludingAnchor
                .replace(/\s+/g, ' ')
                .trim()
                .split(/\s+/)
                .filter(w => w.length > 0)
                .length;

            // Start at first word after the heading (word index = wordsBefore is first word after)
            return Math.min(wordsBefore, Math.max(0, chapter.words.length - 1));
        } catch (e) {
            console.error('Error finding anchor:', e);
            return 0;
        }
    },

    /**
     * Expand sections that contain the active chapter
     */
    expandSectionsForChapter(bookId, chapterIndex) {
        const book = this.currentBook;
        if (!book || !book.toc) return;
        
        const container = this.elements.libraryContainer;
        const bookItem = container.querySelector(`.book-item[data-book-id="${bookId}"]`);
        if (!bookItem) return;
        
        // Find the chapter's href
        const chapter = book.chapters[chapterIndex];
        if (!chapter) return;
        
        // Find which section contains this chapter
        const containingSection = this.findContainingSection(book.toc, chapter.href);
        if (containingSection) {
            const sectionHeader = bookItem.querySelector(
                `.section-header[data-section-id="${containingSection.id}"]`
            );
            if (sectionHeader) {
                const section = sectionHeader.closest('.toc-section');
                if (!section.classList.contains('expanded')) {
                    section.classList.add('expanded');
                    const children = section.querySelector('.section-children');
                    if (children) {
                        children.style.maxHeight = children.scrollHeight + 'px';
                    }
                }
            }
        }
    },

    /**
     * Find which section contains a given href
     */
    findContainingSection(items, href, currentSection = null) {
        for (const item of items) {
            if (item.type === 'section' && item.children) {
                // Check if any child matches
                for (const child of item.children) {
                    if (child.href && this.hrefMatch(child.href, href)) {
                        return item;
                    }
                    if (child.type === 'section') {
                        const nested = this.findContainingSection([child], href, item);
                        if (nested) return nested;
                    }
                }
            }
        }
        return null;
    },

    /**
     * Check if two hrefs match (handling anchors and path differences)
     */
    hrefMatch(href1, href2) {
        const normalized1 = href1.split('#')[0].toLowerCase();
        const normalized2 = href2.split('#')[0].toLowerCase();
        
        if (normalized1 === normalized2) return true;
        
        // Also check filename only
        const filename1 = normalized1.split('/').pop();
        const filename2 = normalized2.split('/').pop();
        
        return filename1 === filename2;
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
        
        const textSpan = this.elements.chapterToggle.querySelector('span');
        const iconSpan = this.elements.chapterToggle.querySelector('.toggle-icon');
        
        if (this.chapterPanelOpen) {
            this.elements.chapterPanel.classList.add('expanded');
            this.elements.chapterToggle.classList.add('expanded');
            textSpan.textContent = 'Hide Chapter Text';
            iconSpan.textContent = '▲';
        } else {
            this.elements.chapterPanel.classList.remove('expanded');
            this.elements.chapterToggle.classList.remove('expanded');
            textSpan.textContent = 'Show Chapter Text';
            iconSpan.textContent = '▲';
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
        
        // Save WPM setting for next session
        StorageManager.saveSettings({ wpm: clampedWPM });
    },

    /**
     * Adjust font size for Spritz word
     */
    adjustFontSize(delta) {
        const currentSize = parseInt(this.elements.fontSizeValue.textContent) || 96;
        const newSize = currentSize + delta;
        const clampedSize = Math.max(32, Math.min(240, newSize));
        
        this.elements.fontSizeValue.textContent = clampedSize;
        
        // Apply font size to spritz word display
        const spritzWord = document.getElementById('spritzWord');
        if (spritzWord) {
            spritzWord.style.fontSize = clampedSize + 'px';
        }
        
        // Save font size setting for next session
        StorageManager.saveSettings({ fontSize: clampedSize });
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
            case 'Equal':
                event.preventDefault();
                this.adjustWPM(10);
                break;
            case 'Minus':
                event.preventDefault();
                this.adjustWPM(-10);
                break;
            case 'NumpadAdd':
                event.preventDefault();
                this.adjustWPM(10);
                break;
            case 'NumpadSubtract':
                event.preventDefault();
                this.adjustWPM(-10);
                break;
            case 'Comma':
                event.preventDefault();
                this.adjustFontSize(-4);
                break;
            case 'Period':
                event.preventDefault();
                this.adjustFontSize(4);
                break;
            case 'KeyZ':
                event.preventDefault();
                this.toggleZenMode();
                break;
            case 'KeyF':
                event.preventDefault();
                this.toggleZenMode();
                break;
            case 'Escape':
                if (this.isZenMode) {
                    event.preventDefault();
                    this.exitZenMode();
                }
                break;
        }
    },

    /**
     * Enter zen mode - distraction-free reading
     */
    enterZenMode() {
        if (this.isZenMode) return;

        console.log('[ZEN MODE] Entering zen mode...');

        // Instant switch - no delay, no pause
        document.body.classList.add('zen-mode');
        this.isZenMode = true;

        // Request fullscreen immediately
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.log('[ZEN MODE] Fullscreen request failed:', err);
            });
        }

        console.log('[ZEN MODE] Zen mode active');
    },

    /**
     * Exit zen mode - return to normal view
     */
    exitZenMode() {
        if (!this.isZenMode) return;
        
        console.log('[ZEN MODE] Exiting zen mode...');
        
        // Remove zen mode class
        document.body.classList.remove('zen-mode');
        
        // Exit fullscreen
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(err => {
                console.log('[ZEN MODE] Exit fullscreen failed:', err);
            });
        }
        
        // Clean up transition class after animation
        setTimeout(() => {
            document.body.classList.remove('zen-mode-transition');
        }, 300);
        
        this.isZenMode = false;
        console.log('[ZEN MODE] Returned to normal mode');
    },

    /**
     * Toggle zen mode on/off
     */
    toggleZenMode() {
        if (this.isZenMode) {
            this.exitZenMode();
        } else {
            this.enterZenMode();
        }
    },

    /**
     * Highlight active chapter in sidebar
     * @param {string} bookId - Book ID
     * @param {number} chapterIndex - Chapter index
     * @param {string} anchor - Optional anchor to match specific section
     */
    highlightActiveChapter(bookId, chapterIndex, anchor = '') {
        const container = this.elements.libraryContainer;
        
        // Remove all active classes
        container.querySelectorAll('.chapter-item').forEach(c => {
            c.classList.remove('active', 'reading');
        });
        
        // Find matching chapter items
        const matchingItems = container.querySelectorAll(
            `.chapter-item[data-book-id="${bookId}"][data-chapter-index="${chapterIndex}"]`
        );
        
        if (matchingItems.length === 0) return;
        
        // If anchor provided, try to find exact match
        if (anchor) {
            const exactMatch = Array.from(matchingItems).find(item => 
                item.dataset.anchor === anchor
            );
            if (exactMatch) {
                exactMatch.classList.add('active', 'reading');
                return;
            }
        }
        
        // Otherwise, highlight first match or all matches if multiple sections in same chapter
        matchingItems.forEach((item, index) => {
            if (index === 0 || anchor) {
                item.classList.add('active', 'reading');
            }
        });
    },

    /**
     * Reset reader to initial state
     */
    resetReader() {
        this.elements.bookInfo.innerHTML = '<span class="no-book">Select a book to start reading</span>';
        this.elements.chapterTitle.innerHTML = 'Select a chapter';
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
            setTimeout(async () => {
                await this.loadChapter(this.currentBook.id, nextIndex);
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