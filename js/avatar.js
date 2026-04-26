// ── Avatar Module ──────────────────────────────────────────────
// Manages user profiles stored in xAPI Agent Profile API.
// Provides avatar rendering used across all pages.
// Loaded after auth.js and xapi.js on every protected page.

const AVATAR_COLORS = [
    '#c1121f','#e63946','#f4845f',
    '#e76f51','#f4a261','#e9c46a',
    '#2a9d8f','#52b788','#40916c',
    '#0077b6','#0096c7','#4361ee',
    '#7209b7','#a855f7','#c77dff',
    '#ff6b9d','#f72585','#b5179e',
    '#6b705c','#3d405b','#264653',
];

const PROFILE_ID = 'user-profile';

// In-memory cache of all loaded profiles keyed by mbox
const _profileCache = {};

const Avatar = {

    // ── Agent Profile URL ──────────────────────────────────
    profileUrl(session) {
        const agent = encodeURIComponent(JSON.stringify({ mbox: session.mbox }));
        return session.endpoint.replace('/xapi/std', '')
            + '/xapi/std/agents/profile'
            + '?agent=' + agent
            + '&profileId=' + PROFILE_ID;
    },

    // ── Load Profile ───────────────────────────────────────
    // Returns profile object or sensible defaults.
    async loadProfile(session) {
        const cached = _profileCache[session.mbox];
        if (cached) return cached;

        try {
            const response = await fetch(this.profileUrl(session), {
                method: 'GET',
                headers: XApi.headers(session),
            });

            if (response.ok) {
                const data = await response.json();
                _profileCache[session.mbox] = data;
                return data;
            }
        } catch { /* fall through to defaults */ }

        // Return defaults if no profile exists yet
        const defaults = this.defaultProfile(session);
        _profileCache[session.mbox] = defaults;
        return defaults;
    },

    // ── Save Profile ───────────────────────────────────────
    async saveProfile(session, profile) {
        _profileCache[session.mbox] = profile;

        // Use If-None-Match / If-Match via a simple approach —
        // GET first to check existence, then PUT with correct header
        try {
            const checkRes = await fetch(this.profileUrl(session), {
                method: 'GET',
                headers: XApi.headers(session),
            });

            const putHeaders = {
                ...XApi.headers(session),
            };

            if (checkRes.ok) {
                const etag = checkRes.headers.get('ETag');
                if (etag) putHeaders['If-Match'] = etag;
                else putHeaders['If-Match'] = '*';
            } else {
                putHeaders['If-None-Match'] = '*';
            }

            await fetch(this.profileUrl(session), {
                method: 'PUT',
                headers: putHeaders,
                body: JSON.stringify(profile),
            });
        } catch (err) {
            console.warn('Profile save failed:', err);
        }
    },

    // ── Default Profile ────────────────────────────────────
    defaultProfile(session) {
        // Pick a deterministic color based on the display name
        const idx   = session.displayName.charCodeAt(0) % AVATAR_COLORS.length;
        return {
            displayName:  session.displayName,
            avatarColor:  AVATAR_COLORS[idx],
            avatarImage:  null,
            theme:        localStorage.getItem('12414-theme') || 'forest-green',
            mode:         localStorage.getItem('12414-mode')  || 'system',
            streakCount:  0,
            streakLastDate: null,
            lastVisit:    null,
            points:       0,
        };
    },

    // ── Apply Theme From Profile ───────────────────────────
    // Called immediately after profile loads on every page.
    applyProfileTheme(profile) {
        if (profile.theme) {
            localStorage.setItem('12414-theme', profile.theme);
            document.documentElement.setAttribute('data-theme', profile.theme);
        }
        if (profile.mode) {
            localStorage.setItem('12414-mode', profile.mode);
            if (profile.mode === 'system') {
                document.documentElement.removeAttribute('data-mode');
            } else {
                document.documentElement.setAttribute('data-mode', profile.mode);
            }
        }
    },

    // ── Update Last Visit ──────────────────────────────────
    async updateLastVisit(session, profile) {
        profile.lastVisit = new Date().toISOString();
        await this.saveProfile(session, profile);
    },

    // ── Streak Update ──────────────────────────────────────
    async recordActivity(session, profile) {
        const today = new Date().toISOString().split('T')[0];
        if (profile.streakLastDate === today) return profile; // already recorded today

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yStr = yesterday.toISOString().split('T')[0];

        if (profile.streakLastDate === yStr) {
            profile.streakCount = (profile.streakCount || 0) + 1;
        } else {
            profile.streakCount = 1; // reset or start
        }

        profile.streakLastDate = today;
        profile.points = (profile.points || 0) + 10;
        await this.saveProfile(session, profile);
        return profile;
    },

    // ── Render Avatar Element ──────────────────────────────
    // Returns an HTMLElement ready to insert into the DOM.
    // profile: { displayName, avatarColor, avatarImage }
    // size: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl'
    render(profile, size = 'sm') {
        const el = document.createElement('div');
        el.className = `avatar avatar-${size}`;
        el.style.background = profile.avatarColor || '#2d6a4f';
        el.title = profile.displayName || '';

        if (profile.avatarImage) {
            const img = document.createElement('img');
            img.src = profile.avatarImage;
            img.alt = profile.displayName || '';
            el.appendChild(img);
        } else {
            el.textContent = (profile.displayName || '?').charAt(0).toUpperCase();
        }
        return el;
    },

    // ── Render Avatar HTML String ──────────────────────────
    // For use inside innerHTML templates.
    html(profile, size = 'sm') {
        const color  = profile?.avatarColor || '#2d6a4f';
        const letter = (profile?.displayName || '?').charAt(0).toUpperCase();
        const title  = profile?.displayName || '';

        if (profile?.avatarImage) {
            return `<div class="avatar avatar-${size}" style="background:${color}" title="${title}">
                        <img src="${profile.avatarImage}" alt="${title}" />
                    </div>`;
        }
        return `<div class="avatar avatar-${size}" style="background:${color}" title="${title}">
                    ${letter}
                </div>`;
    },

    // ── Render Avatar Stack HTML ───────────────────────────
    // profiles: array of profile objects
    stackHtml(profiles, size = 'xs') {
        if (!profiles || profiles.length === 0) return '';
        return `<div class="avatar-stack">
            ${profiles.map(p => this.html(p, size)).join('')}
        </div>`;
    },

    // ── Update Header Avatar ───────────────────────────────
    // Replaces the header user text with a clickable avatar.
    updateHeader(profile) {
        const container = document.getElementById('header-avatar-area');
        if (!container) return;
        container.innerHTML = `
            <button class="header-avatar-btn" onclick="window.location.href='profile.html'">
                ${this.html(profile, 'sm')}
            </button>
        `;
    },

    // ── Resize Image for Storage ───────────────────────────
    // Reads a File, resizes to maxSize px, returns base64 JPEG string.
    resizeImage(file, maxSize = 150) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const scale  = Math.min(maxSize / img.width, maxSize / img.height);
                    canvas.width  = Math.round(img.width  * scale);
                    canvas.height = Math.round(img.height * scale);
                    const ctx = canvas.getContext('2d');

                    // Draw circular crop
                    const size = Math.min(canvas.width, canvas.height);
                    canvas.width  = size;
                    canvas.height = size;
                    ctx.beginPath();
                    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
                    ctx.clip();
                    const offsetX = (canvas.width  - img.width  * scale) / 2;
                    const offsetY = (canvas.height - img.height * scale) / 2;
                    ctx.drawImage(img, offsetX, offsetY,
                        img.width * scale, img.height * scale);

                    resolve(canvas.toDataURL('image/jpeg', 0.75));
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    },

    // ── Color Picker HTML ──────────────────────────────────
    colorGridHtml(currentColor) {
        return `<div class="color-grid">
            ${AVATAR_COLORS.map(c => `
                <div class="color-swatch ${c === currentColor ? 'active' : ''}"
                     style="background:${c}"
                     onclick="selectAvatarColor('${c}')"
                     title="${c}"></div>
            `).join('')}
        </div>`;
    },
};