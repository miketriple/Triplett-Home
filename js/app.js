// ── App Utilities ──────────────────────────────────────────────
// Shared helpers used across all pages.

const App = {

    // Safely insert user-provided text into the DOM
    escapeHtml(text) {
        const div = document.createElement('div');
        div.appendChild(document.createTextNode(text));
        return div.innerHTML;
    },

    // Format an ISO date string to "Apr 20" style
    formatDate(isoString) {
        return new Date(isoString).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
        });
    },

    // Generate a unique ID for new items
    randomId() {
        return crypto.randomUUID();
    },

    // Show a brief toast notification at the bottom of the screen
    showToast(message, type = 'success') {
        const existing = document.getElementById('app-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'app-toast';
        toast.textContent = message;

        Object.assign(toast.style, {
            position:     'fixed',
            bottom:       '1.5rem',
            left:         '50%',
            transform:    'translateX(-50%)',
            background:   type === 'error' ? '#ef4444' : '#22c55e',
            color:        'white',
            padding:      '0.6rem 1.25rem',
            borderRadius: '999px',
            fontSize:     '0.875rem',
            fontWeight:   '600',
            zIndex:       '999',
            boxShadow:    '0 4px 16px rgba(0,0,0,0.15)',
            whiteSpace:   'nowrap',
            animation:    'none',
        });

        document.body.appendChild(toast);
        setTimeout(() => {
            if (toast.parentNode) toast.remove();
        }, 2500);
    },

    // Set the user name in the header
    setHeaderUser(session) {
        const el = document.getElementById('header-user');
        if (el) el.textContent = session.displayName;
    },

    // Handle overlay click-outside-to-close for theme panel
    handleOverlayClick(event, overlayId) {
        if (event.target.id === overlayId) Theme.closePanel();
    },
};
