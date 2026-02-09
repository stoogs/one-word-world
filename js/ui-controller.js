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
    expandedSections: new Set(), // Track expanded sections by ID

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
        
        // Delegate events for dynamic content
        e.libraryContainer.addEventListener('click', (e) => this.handleLibraryClick(e));
    },

    /**
     * Handle clicks in library container (event delegation)
     */
    handleLibraryClick(event) {
        // Handle delete button
        const deleteBtn = event.target.closest('.delete-book');
        if (deleteBtn) {
            event.stopPropagation();
            const bookId = deleteBtn.dataset.bookId;
            this.deleteBook(bookId);
            return;
        }
        
        // Handle section toggle
        const sectionHeader = event.target.closest('.section-header');
        if (sectionHeader) {
            const bookId = sectionHeader.dataset.bookId;
            const sectionId = sectionHeader.dataset.sectionId;
            this.toggleSection(bookId, sectionId, sectionHeader);
            return;
        }
        
        // Handle chapter click
        const chapterItem = event.target.closest('.chapter-item');
        if (chapterItem) {
            const bookId = chapterItem.dataset.bookId;
            const chapterIndex = parseInt(chapterItem.dataset.chapterIndex);
            this.loadChapter(bookId, chapterIndex);
            return;
        }
        
        // Handle book header click (main toggle)
        const bookHeader = event.target.closest('.book-header');
        if (bookHeader) {
            const bookId = bookHeader.dataset.bookId;
            const bookItem = bookHeader.closest('.book-item');
            bookItem.classList.toggle('expanded');
            this.loadBook(bookId);
        }
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
            
            console.log(`Parsed "${bookData.title}" with ${bookData.chapters.length} chapters`);
            
            // Save book (10MB limit)
            const saved = StorageManager.addBook(bookData);
            
            if (!saved) {
                console.error('Storage limit reached');
                alert('Unable to save book - storage limit reached (10MB). Try removing some books first.');
                return;
            }
            
            console.log('Book saved successfully');
            
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
    },

    /**
     * Render single book item with hierarchical TOC
     */
    renderBookItem(book) {
        const isExpanded = this.currentBook && this.currentBook.id === book.id;
        const isActive = isExpanded ? 'active' : '';
        const expandedClass = isExpanded ? 'expanded' : '';
        
        const coverHtml = book.cover 
            ? `<img src="${book.cover}" alt="Cover">`
            : '📖';
        
        // Render hierarchical TOC
        const tocHtml = book.toc && book.toc.length > 0
            ? this.renderTOCTree(book.toc, book.id, book.chapters || [])
            : '<div class="no-toc">No table of contents available</div>';
        
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
                <div class="toc-tree">
                    ${tocHtml}
                </div>
            </div>
        `;
    },

    /**
     * Render TOC tree recursively
     */
    renderTOCTree(items, bookId, chapters) {
        if (!items || items.length === 0) return '';
        
        // Debug logging
        console.log(`Rendering TOC tree: ${items.length} items, ${chapters?.length || 0} chapters available`);
        
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
                            <span class="section-title">${this.escapeHtml(item.title || 'Section')}</span>
                        </div>
                        <div class="section-children">
                            ${this.renderTOCTree(item.children, bookId, chapters)}
                        </div>
                    </div>
                `;
            } else {
                // Regular item or leaf node - find matching chapter
                const chapterIndex = EpubParser.findChapterIndexByHref(chapters, item.href);
                if (chapterIndex === -1) {
                    // This TOC item doesn't have a matching chapter (might be non-reading content)
                    console.log(`No chapter found for TOC item: "${item.title}" href: ${item.href}`);
                    return '';
                }
                
                const chapter = chapters[chapterIndex];
                const title = chapter.displayNumber + (chapter.title ? ': ' + chapter.title : '');
                const preview = chapter.preview || '';
                
                return `
                    <div class="chapter-item" 
                         data-book-id="${bookId}" 
                         data-chapter-index="${chapterIndex}">
                        <div class="chapter-title">${this.escapeHtml(title)}</div>
                        ${preview ? `<div class="chapter-preview">${this.escapeHtml(preview)}</div>` : ''}
                    </div>
                `;
            }
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
    toggleSection(bookId, sectionId, sectionHeader) {
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
                this.loadChapter(bookId, parseInt(firstChapterIndex));
            }
        }
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
        
        // Update chapter header with both title and preview
        const title = chapter.displayNumber + (chapter.title ? ': ' + chapter.title : '');
        const preview = chapter.preview || '';
        
        this.elements.chapterTitle.innerHTML = `
            <div class="chapter-title-line">${this.escapeHtml(title)}</div>
            ${preview ? `<div class="chapter-preview-line">${this.escapeHtml(preview)}</div>` : ''}
        `;
        
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
        
        // Expand sections containing this chapter
        this.expandSectionsForChapter(bookId, chapterIndex);
        
        // Save progress
        StorageManager.saveProgress(bookId, chapterIndex, wordIndex);
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