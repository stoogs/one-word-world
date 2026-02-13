/**
 * Theme Manager - Handles dark/light mode switching
 */

const ThemeManager = {
    currentTheme: 'dark',

    /**
     * Initialize theme manager
     */
    init() {
        const settings = StorageManager.getSettings();
        this.currentTheme = settings.theme || 'dark';
        this.applyTheme(this.currentTheme);
        return this;
    },

    /**
     * Apply theme to document
     */
    applyTheme(theme) {
        const body = document.body;
        
        if (theme === 'light') {
            body.classList.remove('dark-theme');
            body.classList.add('light-theme');
        } else {
            body.classList.remove('light-theme');
            body.classList.add('dark-theme');
        }
        
        this.currentTheme = theme;
        this.updateToggleIcon();
        
        // Save to storage
        StorageManager.saveSettings({ theme });
    },

    /**
     * Toggle between light and dark
     */
    toggle() {
        const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
        this.applyTheme(newTheme);
        return newTheme;
    },

    /**
     * Get current theme
     */
    getCurrent() {
        return this.currentTheme;
    },

    /**
     * Update toggle button icon
     */
    updateToggleIcon() {
        const toggle = document.getElementById('themeToggle');
        if (toggle) {
            const icon = toggle.querySelector('.icon');
            if (icon) {
                icon.textContent = this.currentTheme === 'dark' ? '☀️' : '🌙';
            }
        }
    },

    /**
     * Check if dark mode is active
     */
    isDark() {
        return this.currentTheme === 'dark';
    }
};