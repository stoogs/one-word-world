# Implementation Plan: Keyboard Shortcuts & UI Updates

## Summary of Changes Requested

### 1. Keyboard Shortcuts (+/- for WPM)
**Location:** `js/ui-controller.js` - `handleKeydown()` method

**Current behavior:**
- ArrowUp: Increase WPM by 10
- ArrowDown: Decrease WPM by 10

**New behavior (add alongside):**
- `+` (Shift+Equal): Increase WPM by 10
- `-` (Minus key): Decrease WPM by 10  
- Numpad `+`: Increase WPM by 10
- Numpad `-`: Decrease WPM by 10

**Implementation:**
```javascript
case 'Equal':
    if (event.shiftKey) {
        event.preventDefault();
        this.adjustWPM(10);
    }
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
```

---

### 2. Chapter Text Toggle Button
**Files to modify:**
- `index.html` - Initial button text
- `js/ui-controller.js` - Toggle functionality
- `css/styles.css` - Button styling

**Changes:**
- Default state: Chapter text panel VISIBLE (currently hidden)
- Button text: "Hide Chapter Text ▲" when visible, "Show Chapter Text ▲" when hidden
- Both states use ▲ arrow

**Current HTML:**
```html
<button class="chapter-toggle" id="chapterToggle">
    <span>Show Chapter Text</span>
    <span class="toggle-icon">▼</span>
</button>
```

**New HTML:**
```html
<button class="chapter-toggle" id="chapterToggle">
    <span>Hide Chapter Text</span>
    <span class="toggle-icon">▲</span>
</button>
```

**JavaScript changes:**
- Initialize panel as visible by default
- Toggle text between "Show Chapter Text ▲" and "Hide Chapter Text ▲"

---

### 3. Storage Limit Text (10MB → 1MB)
**Files to modify:**

**a) `index.html` - Storage info panel (line ~26)**
**Current:**
```html
<div class="storage-info">
    <strong>Browser Storage Limit</strong>
    Only 1 active book at a time (~10MB limit). Remove current book before uploading a new one.
</div>
```

**New:**
```html
<div class="storage-info">
    <strong>Browser Storage Limit</strong>
    Only 1 active book at a time (~1MB limit). Remove current book before uploading a new one.
</div>
```

**b) `js/ui-controller.js` - Error message (line ~275)**
**Current:**
```javascript
alert('Browser limited to 1 active book at a time (~10MB storage limit).\n\nPlease remove (unload) current book first, then upload the new one.\n\nYour reading progress will be saved and you can resume later.');
```

**New:**
```javascript
alert('Browser limited to 1 active book at a time (~1MB storage limit).\n\nPlease remove (unload) current book first, then upload the new one.\n\nYour reading progress will be saved and you can resume later.');
```

---

## Implementation Steps

1. **Keyboard shortcuts** - Add cases to switch statement in handleKeydown()
2. **Chapter toggle** - Update HTML, JS toggle logic, and CSS if needed
3. **Storage text** - Find and replace "10MB" with "1MB" in 2 locations

**Estimated time:** 10-15 minutes

Ready to implement?