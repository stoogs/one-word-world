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
            let tocTree = [];
            let flatToc = [];
            
            if (opfData.ncx) {
                const ncxContent = await this.getFileContent(zip, basePath + opfData.ncx);
                if (ncxContent) {
                    const parsed = this.parseNCXHierarchical(ncxContent);
                    tocTree = parsed.tree;
                    flatToc = parsed.flat;
                }
            } else if (opfData.nav) {
                const navContent = await this.getFileContent(zip, basePath + opfData.nav);
                if (navContent) {
                    const parsed = this.parseNAVHierarchical(navContent);
                    tocTree = parsed.tree;
                    flatToc = parsed.flat;
                }
            }
            
            // Load cover image if available
            let cover = null;
            if (opfData.cover) {
                cover = await this.getFileDataUrl(zip, basePath + opfData.cover);
            }
            
            // Process spine into hierarchical chapters
            const chapters = await this.processSpineHierarchical(
                zip, opfData.spine, opfData.manifest, basePath, tocTree
            );
            
            // Generate consistent ID based on title + author
            const title = opfData.metadata.title || 'Untitled';
            const author = opfData.metadata.creator || 'Unknown Author';
            const id = this.generateId(title, author);
            
            return {
                id,
                fileName: file.name,
                title: opfData.metadata.title || 'Untitled',
                author: opfData.metadata.creator || 'Unknown Author',
                description: opfData.metadata.description || '',
                cover,
                toc: tocTree,           // Hierarchical TOC
                flatToc,               // Flat list for reference
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
     * Parse NCX file hierarchically
     */
    parseNCXHierarchical(xml) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'application/xml');
        
        const tree = [];
        const flat = [];
        
        // Get all top-level navPoints
        const navMap = doc.querySelector('navMap');
        if (navMap) {
            const topLevelPoints = Array.from(navMap.children).filter(
                child => child.tagName.toLowerCase() === 'navpoint'
            );
            
            topLevelPoints.forEach((point, index) => {
                const item = this.parseNavPoint(point, index, flat);
                tree.push(item);
            });
        }
        
        return { tree, flat };
    },

    /**
     * Parse individual navPoint recursively
     */
    parseNavPoint(point, index, flatList, depth = 0) {
        const label = point.querySelector('navLabel text');
        const content = point.querySelector('content');
        const children = Array.from(point.children).filter(
            child => child.tagName.toLowerCase() === 'navpoint'
        );
        
        const title = label ? this.cleanTitle(label.textContent) : '';
        let href = content ? content.getAttribute('src') : '';
        if (href) href = href.trim();
        const item = {
            id: point.getAttribute('id') || `nav-${index}`,
            title,
            href,
            depth,
            type: children.length > 0 ? 'section' : 'item'
        };
        
        flatList.push(item);
        
        if (children.length > 0) {
            item.children = [];
            children.forEach((child, childIndex) => {
                const childItem = this.parseNavPoint(child, childIndex, flatList, depth + 1);
                item.children.push(childItem);
            });
        }
        
        return item;
    },

    /**
     * Parse NAV file (EPUB3) hierarchically. Tries toc nav first, then any nav with ol, then flat links.
     */
    parseNAVHierarchical(xml) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'application/xml');

        const tree = [];
        const flat = [];

        const tocElement =
            doc.querySelector('nav[epub:type="toc"]') ||
            doc.querySelector('nav[epub\\:type="toc"]') ||
            doc.querySelector('nav');

        if (tocElement) {
            const ol = tocElement.querySelector('ol');
            if (ol) {
                const listItems = Array.from(ol.children).filter(li => li.tagName && li.tagName.toLowerCase() === 'li');
                listItems.forEach((li, index) => {
                    const item = this.parseNavListItem(li, index, flat);
                    tree.push(item);
                });
            }
            if (tree.length === 0) {
                const links = tocElement.querySelectorAll('a[href]');
                links.forEach((a, index) => {
                    const href = (a.getAttribute('href') || '').trim();
                    const title = this.cleanTitle(a.textContent);
                    if (href) {
                        const item = { id: `nav-${index}`, title, href, depth: 0, type: 'item' };
                        tree.push(item);
                        flat.push(item);
                    }
                });
            }
        }

        return { tree, flat };
    },

    /**
     * Parse NAV list item recursively
     */
    parseNavListItem(li, index, flatList, depth = 0) {
        const link = li.querySelector('a');
        const ol = li.querySelector('ol');
        
        const title = link ? this.cleanTitle(link.textContent) : '';
        let href = link ? link.getAttribute('href') : '';
        if (href) href = href.trim();
        const item = {
            id: `nav-${index}`,
            title,
            href,
            depth,
            type: ol ? 'section' : 'item'
        };
        
        flatList.push(item);
        
        if (ol) {
            item.children = [];
            const children = Array.from(ol.children);
            children.forEach((child, childIndex) => {
                const childItem = this.parseNavListItem(child, childIndex, flatList, depth + 1);
                item.children.push(childItem);
            });
        }
        
        return item;
    },

    /**
     * Process spine into hierarchical chapters
     */
    async processSpineHierarchical(zip, spine, manifest, basePath, tocTree) {
        // Build flat list of chapters with chapterIndex
        const allChapters = [];
        let sequentialChapterNum = 0;
        
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
            
            sequentialChapterNum++;
            
            // Extract title and preview
            const { title, preview } = this.extractTitleAndPreview(content, href, words);
            
            allChapters.push({
                id: itemId,
                href,
                title,
                preview,
                displayNumber: ``,
                words,
                content,
                chapterIndex: allChapters.length
            });
        }
        
        return allChapters;
    },

    /**
     * Extract title and preview from content
     * Priority: h1 → h2 → first 4 words
     * Preview is always first 4 words
     */
    extractTitleAndPreview(html, href, words) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        
        let title = '';
        
        // 1. Try h1 tag first
        const h1 = doc.querySelector('h1');
        if (h1) {
            const h1Text = this.cleanTitle(h1.textContent);
            if (h1Text && h1Text !== '.' && h1Text !== ' ') {
                title = h1Text;
            }
        }
        
        // 2. Try h2 tag
        if (!title) {
            const h2 = doc.querySelector('h2');
            if (h2) {
                const h2Text = this.cleanTitle(h2.textContent);
                if (h2Text && h2Text !== '.' && h2Text !== ' ') {
                    title = h2Text;
                }
            }
        }
        
        // 3. Use first 4 words as title
        if (!title && words && words.length >= 4) {
            title = words.slice(0, 4).join(' ');
        }
        
        // 4. Fallback
        if (!title) {
            title = 'Untitled';
        }
        
        // Always generate preview from first 4 words
        let preview = '';
        if (words && words.length >= 4) {
            preview = words.slice(0, 4).join(' ') + '...';
        }
        
        return { title, preview };
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
     * Normalize href for TOC matching (handles encoding, relative paths, anchors)
     */
    normalizeHref(href) {
        if (!href || typeof href !== 'string') return '';
        let s = href.split('#')[0].trim();
        try {
            s = decodeURIComponent(s);
        } catch (_) { /* leave as-is if not valid URI */ }
        s = s.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
        // Remove leading . or ./
        s = s.replace(/^\.\/?/, '');
        return s;
    },

    /**
     * Get filename part of path for loose matching (e.g. "path/to/chap.xhtml" -> "chap.xhtml")
     */
    hrefFilename(href) {
        const n = this.normalizeHref(href);
        const part = n.split('/').pop();
        return part || n;
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
     * Generate consistent ID for book based on title + author
     * This allows progress to be restored when re-uploading the same book
     */
    generateId(title, author) {
        // Create a simple hash from title + author
        const str = (title + '|' + author).toLowerCase().trim();
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        // Convert to positive base36 string
        const hashStr = Math.abs(hash).toString(36);
        const id = 'book-' + hashStr;
        console.log(`[ID] Generated ID: ${id} for "${title}" by "${author}"`);
        return id;
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
            index: chapterIndex,
            totalChapters: book.chapters.length
        };
    },

    /**
     * Match TOC item to chapter by href (robust: exact path, filename, and path endings)
     */
    findChapterIndexByHref(chapters, href) {
        if (!chapters || !chapters.length || href == null) return -1;
        const normalizedTarget = this.normalizeHref(href);
        const targetFilename = this.hrefFilename(href);
        if (!normalizedTarget && !targetFilename) return -1;

        for (let i = 0; i < chapters.length; i++) {
            const ch = chapters[i].href;
            const normalizedChapter = this.normalizeHref(ch);
            const chapterFilename = this.hrefFilename(ch);

            if (normalizedChapter === normalizedTarget) return i;
            if (chapterFilename && targetFilename && chapterFilename === targetFilename) return i;
            // One path may be relative (short), the other with base (e.g. "chap.xhtml" vs "text/chap.xhtml")
            if (normalizedChapter && normalizedChapter.endsWith('/' + targetFilename)) return i;
            if (normalizedTarget && normalizedTarget.endsWith('/' + chapterFilename)) return i;
        }

        return -1;
    }
};