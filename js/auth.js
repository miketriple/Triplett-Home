// ── Auth Manager ──────────────────────────────────────────────
// Handles login, logout, and session persistence across pages.
// Uses sessionStorage so session clears when the browser tab closes.

const AUTH_ENDPOINT = 'https://lrs.the12414.com/auth/token';

const Auth = {

    getSession() {
        const raw = sessionStorage.getItem('12414-session');
        if (!raw) return null;
        try {
            const session = JSON.parse(raw);
            // Check token expiry
            if (session.expires < Math.floor(Date.now() / 1000)) {
                this.clearSession();
                return null;
            }
            return session;
        } catch {
            return null;
        }
    },

    setSession(data) {
        sessionStorage.setItem('12414-session', JSON.stringify(data));
    },

    clearSession() {
        sessionStorage.removeItem('12414-session');
    },

    // Call on every protected page. Redirects to login if no valid session.
    requireSession() {
        const session = this.getSession();
        if (!session) {
            window.location.href = 'index.html';
            return null;
        }
        return session;
    },

    async login(username, password) {
        const response = await fetch(AUTH_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: username.toLowerCase().trim(),
                password
            })
        });

        if (!response.ok) {
            throw new Error('Invalid name or password.');
        }

        const data = await response.json();

        const session = {
            token:        data.token,
            expires:      data.expires,
            displayName:  data.display_name,
            mbox:         data.mbox,
            traxUsername: data.trax_username,
            traxPassword: data.trax_password,
            endpoint:     data.trax_endpoint,
        };

        this.setSession(session);
        return session;
    },

    logout() {
        this.clearSession();
        window.location.href = 'index.html';
    },
};
