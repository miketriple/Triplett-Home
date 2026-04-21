// ── Theme Manager ─────────────────────────────────────────────
// Handles color themes and light/dark/system mode.
// Runs immediately on load (before body renders) to avoid flash.

const THEMES = [
    { id: 'forest-green',   label: 'Forest',   color: '#2d6a4f' },
    { id: 'red-black-white', label: 'Cardinal', color: '#c1121f' },
    { id: 'purple-indigo',  label: 'Indigo',   color: '#5c4db1' },
    { id: 'slate-gray',     label: 'Slate',    color: '#475569' },
    { id: 'sunset-orange',  label: 'Sunset',   color: '#c2410c' },
    { id: 'ocean-blue',     label: 'Ocean',    color: '#0369a1' },
];

const Theme = {
    get theme() { return localStorage.getItem('12414-theme') || 'forest-green'; },
    get mode()  { return localStorage.getItem('12414-mode')  || 'system'; },

    apply() {
        document.documentElement.setAttribute('data-theme', this.theme);
        if (this.mode === 'system') {
            document.documentElement.removeAttribute('data-mode');
        } else {
            document.documentElement.setAttribute('data-mode', this.mode);
        }
    },

    setTheme(id) {
        localStorage.setItem('12414-theme', id);
        this.apply();
        this.renderPanel();
    },

    setMode(mode) {
        localStorage.setItem('12414-mode', mode);
        this.apply();
        this.renderPanel();
    },

    openPanel() {
        const overlay = document.getElementById('theme-overlay');
        if (overlay) overlay.classList.add('open');
        this.renderPanel();
    },

    closePanel() {
        const overlay = document.getElementById('theme-overlay');
        if (overlay) overlay.classList.remove('open');
    },

    renderPanel() {
        const swatches = document.getElementById('theme-swatches');
        const modes    = document.getElementById('mode-buttons');
        if (!swatches || !modes) return;

        swatches.innerHTML = THEMES.map(t => `
            <button class="theme-swatch ${t.id === this.theme ? 'active' : ''}"
                    onclick="Theme.setTheme('${t.id}')">
                <div class="swatch-dot" style="background:${t.color}"></div>
                ${t.label}
            </button>
        `).join('');

        modes.innerHTML = [
            { id: 'system', icon: '⚙', label: 'System' },
            { id: 'light',  icon: '☀', label: 'Light'  },
            { id: 'dark',   icon: '☾', label: 'Dark'   },
        ].map(m => `
            <button class="mode-btn ${m.id === this.mode ? 'active' : ''}"
                    onclick="Theme.setMode('${m.id}')">
                ${m.icon} ${m.label}
            </button>
        `).join('');
    },
};

// Apply theme immediately to prevent flash of wrong theme
Theme.apply();
