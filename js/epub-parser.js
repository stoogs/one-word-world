/**
 * EPUB Parser - Handles unzipping and parsing of EPUB files
 */

const EpubParser = {
    /**
     * Parse an EPUB file
     * @param {File} file - The EPUB file to parse
     * @returns {Promise<Object>} Parsed book data
     */
    async parse(file) {
        try {
            // Read file as array buffer
            const buffer = await file.arrayBuffer();
            
            // Unzip with JSZip
            const zip = await JSZip.loadAsync(buffer);
            
            // Find container.xml
            const containerXml = await this.getFileContent(zip, 'META-INF/container.xml');
            if (!containerXml) {
                throw new Error('Invalid EPUB: container.xml not found');
            }
            
            // Parse container to find OPF path
            const opfPath = this.parseContainer(containerXml);
            
            // Load and parse OPF
            const opfContent = await this.getFileContent(zip, opfPath);
            if (!opfContent) {
                throw new Error('Invalid EPUB: content.opf not found');
            }
            
            const opfData = this.parseOPF(opfContent);
            
            // Get base path for resolving relative URLs
            const basePath = opfPath.substring(0, opfPath.lastIndexOf('/') + 1);
            
            // Parse NCX or NAV for TOC
            let toc = [];
            if (opfData.ncx) {
                const ncxContent = await this.getFileContent(zip, basePath + opfData.ncx);
                if (ncxContent) {
                    toc = this.parseNCX(ncxContent);
                }
            } else if (opfData.nav) {
                const navContent = await this.getFileContent(zip, basePath + opfData.nav);
                if (navContent) {
                    toc = this.parseNAV(navContent);
                }
            }
            
            // Load cover image if available
            let cover = null;
            if (opfData.cover) {
                cover = await this.getFileDataUrl(zip, basePath + opfData.cover);
            }
            
            // Process spine into chapters
            const chapters = await this.processSpine(zip, opfData.spine, opfData.manifest, basePath, toc);
            
            // Generate unique ID
            const id = this.generateId(file.name);
            
            return {
                id,
                fileName: file.name,
                title: opfData.metadata.title || 'Untitled',
                author: opfData.metadata.creator || 'Unknown Author',
                description: opfData.metadata.description || '',
                cover,
                spine: chapters.map((ch, idx) => ({
                    id: ch.id,
                    href: ch.href,
                    title: ch.title,
                    index: idx
                })),
                toc,
                chapters,
                uploadDate: Date.now()
            };
            
        } catch (error) {
            console.error('EPUB parsing error:', error);
            throw error;
        }
    },

    /**
     * Get file content from zip
     */
    async getFileContent(zip, path) {
        const file = zip.file(path);
        if (!file) return null;
        return await file.async('string');
    },

    /**
     * Get file as data URL
     */
    async getFileDataUrl(zip, path) {
        const file = zip.file(path);
        if (!file) return null;
        
        try {
            const blob = await file.async('blob');
            return await this.blobToDataUrl(blob);
        } catch (e) {
            return null;
        }
    },

    /**
     * Convert blob to data URL
     */
    blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    },

    /**
     * Parse container.xml to find OPF path
     */
    parseContainer(xml) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'application/xml');
        
        const rootfile = doc.querySelector('rootfile');
        if (!rootfile) {
            throw new Error('No rootfile found in container.xml');
        }
        
        return rootfile.getAttribute('full-path');
    },

    /**
     * Parse content.opf
     */
    parseOPF(xml) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'application/xml');
        
        // Extract metadata
        const metadata = {};
        const metaElements = doc.querySelectorAll('metadata > *');
        metaElements.forEach(el => {
            const tag = el.tagName.toLowerCase();
            if (tag.startsWith('dc:')) {
                const key = tag.replace('dc:', '');
                if (!metadata[key]) metadata[key] = [];
                metadata[key].push(el.textContent.trim());
            }
        });
        
        // Use first value for simple fields
        const simpleMetadata = {};
        for (const [key, values] of Object.entries(metadata)) {
            simpleMetadata[key] = values[0];
        }
        
        // Parse manifest
        const manifest = {};
        const manifestItems = doc.querySelectorAll('manifest > item');
        manifestItems.forEach(item => {
            const id = item.getAttribute('id');
            manifest[id] = {
                href: item.getAttribute('href'),
                mediaType: item.getAttribute('media-type'),
                properties: item.getAttribute('properties') || ''
            };
        });
        
        // Parse spine (reading order)
        const spine = [];
        const spineItems = doc.querySelectorAll('spine > itemref');
        spineItems.forEach(item => {
            const idref = item.getAttribute('idref');
            const linear = item.getAttribute('linear') !== 'no';
            if (idref && linear) {
                spine.push(idref);
            }
        });
        
        // Find cover
        let cover = null;
        const coverMeta = doc.querySelector('meta[name="cover"]');
        if (coverMeta) {
            const coverId = coverMeta.getAttribute('content');
            if (manifest[coverId]) {
                cover = manifest[coverId].href;
            }
        }
        
        // Also check for cover in manifest properties
        if (!cover) {
            for (const [id, item] of Object.entries(manifest)) {
                if (item.properties.includes('cover-image')) {
                    cover = item.href;
                    break;
                }
            }
        }
        
        // Find NCX or NAV
        let ncx = null;
        let nav = null;
        
        const tocId = doc.querySelector('spine')?.getAttribute('toc');
        if (tocId && manifest[tocId]) {
            ncx = manifest[tocId].href;
        }
        
        for (const [id, item] of Object.entries(manifest)) {
            if (item.properties.includes('nav')) {
                nav = item.href;
                break;
            }
        }
        
        return {
            metadata: simpleMetadata,
            manifest,
            spine,
            cover,
            ncx,
            nav
        };
    },

    /**
     * Parse NCX file for table of contents
     */
    parseNCX(xml) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'application/xml');
        
        const toc = [];
        const navPoints = doc.querySelectorAll('navPoint');
        
        navPoints.forEach((point, index) => {
            const label = point.querySelector('navLabel text');
            const content = point.querySelector('content');
            
            if (label && content) {
                toc.push({
                    title: label.textContent.trim(),
                    href: content.getAttribute('src'),
                    index
                });
            }
        });
        
        return toc;
    },

    /**
     * Parse NAV file (EPUB3) for table of contents
     */
    parseNAV(xml) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'application/xml');
        
        const toc = [];
        const tocElement = doc.querySelector('nav[epub:type="toc"]') || doc.querySelector('nav');
        
        if (tocElement) {
            const links = tocElement.querySelectorAll('a');
            links.forEach((link, index) => {
                toc.push({
                    title: link.textContent.trim(),
                    href: link.getAttribute('href'),
                    index
                });
            });
        }
        
        return toc;
    },

    /**
     * Process spine items into chapters
     */
    async processSpine(zip, spine, manifest, basePath, toc) {
        const chapters = [];
        
        // Build TOC lookup map by href for better matching
        const tocMap = new Map();
        if (toc && toc.length > 0) {
            toc.forEach(entry => {
                // Normalize href for matching (remove anchors, normalize path)
                const normalizedHref = this.normalizeHref(entry.href);
                tocMap.set(normalizedHref, entry.title);
            });
        }
        
        let chapterNum = 0;
        for (const itemId of spine) {
            const manifestItem = manifest[itemId];
            if (!manifestItem) continue;
            
            const href = manifestItem.href;
            const fullPath = basePath + href;
            
            const content = await this.getFileContent(zip, fullPath);
            if (!content) continue;
            
            // Parse HTML content
            const words = this.extractWords(content);
            
            // Filter: skip chapters with fewer than 6 words
            if (words.length < 6) {
                console.log(`Skipping ${href}: only ${words.length} words`);
                continue;
            }
            
            chapterNum++;
            
            // Extract title using priority: h1 → TOC → h2 → first 4 words
            const title = this.extractTitle(content, href, tocMap, chapterNum, words);
            
            chapters.push({
                id: itemId,
                href,
                title,
                words,
                content // Raw HTML for chapter panel
            });
        }
        
        return chapters;
    },

    /**
     * Normalize href for TOC matching
     */
    normalizeHref(href) {
        if (!href) return '';
        // Remove anchor
        const withoutAnchor = href.split('#')[0];
        // Normalize path separators
        return withoutAnchor.replace(/\\/g, '/').toLowerCase();
    },

    /**
     * Extract title from multiple sources (Priority B: h1 → TOC → h2 → first 4 words)
     */
    extractTitle(html, href, tocMap, chapterNum, words) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // 1. Try h1 tag first
        const h1 = doc.querySelector('h1');
        if (h1) {
            const title = this.cleanTitle(h1.textContent);
            if (title) return title;
        }
        
        // 2. Try TOC match by href
        const normalizedHref = this.normalizeHref(href);
        if (tocMap.has(normalizedHref)) {
            const tocTitle = this.cleanTitle(tocMap.get(normalizedHref));
            if (tocTitle) return tocTitle;
        }
        
        // Also try matching just the filename
        const filename = normalizedHref.split('/').pop();
        for (const [tocHref, tocTitle] of tocMap.entries()) {
            if (tocHref.endsWith(filename) || filename.endsWith(tocHref.split('/').pop())) {
                const title = this.cleanTitle(tocTitle);
                if (title) return title;
            }
        }
        
        // 3. Try h2 tag
        const h2 = doc.querySelector('h2');
        if (h2) {
            const title = this.cleanTitle(h2.textContent);
            if (title) return title;
        }
        
        // 4. Use first 4 words + "..."
        if (words && words.length >= 4) {
            return words.slice(0, 4).join(' ') + '...';
        }
        
        // 5. Fallback to "Chapter X"
        return `Chapter ${chapterNum}`;
    },

    /**
     * Clean and validate title text
     */
    cleanTitle(text) {
        if (!text) return '';
        
        // Remove extra whitespace
        let cleaned = text.replace(/\s+/g, ' ').trim();
        
        // Remove common junk characters
        cleaned = cleaned.replace(/^[\s\-–—]+|[\s\-–—]+$/g, '');
        
        // Must be at least 2 characters and not just whitespace/punctuation
        if (cleaned.length < 2 || /^[\s\p{P}]+$/u.test(cleaned)) {
            return '';
        }
        
        return cleaned;
    },

    /**
     * Extract words from HTML content
     */
    extractWords(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        // Get text content from body
        const body = doc.body;
        if (!body) return [];
        
        // Remove script and style elements
        const scripts = body.querySelectorAll('script, style');
        scripts.forEach(s => s.remove());
        
        // Get text content
        const text = body.textContent || '';
        
        // Split into words
        // Keep punctuation attached to words for natural reading
        const words = text
            .replace(/\s+/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(w => w.length > 0);
        
        return words;
    },

    /**
     * Generate unique ID for book
     */
    generateId(fileName) {
        return 'book-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    },

    /**
     * Load a chapter from stored book data
     */
    getChapter(book, chapterIndex) {
        if (!book || !book.chapters || chapterIndex < 0 || chapterIndex >= book.chapters.length) {
            return null;
        }
        
        const chapter = book.chapters[chapterIndex];
        
        return {
            ...chapter,
            title: chapter.title || `Chapter ${chapterIndex + 1}`,
            index: chapterIndex,
            totalChapters: book.chapters.length
        };
    }
};