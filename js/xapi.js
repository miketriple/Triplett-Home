// ── xAPI Manager ──────────────────────────────────────────────
// All communication with the TRAX LRS lives here.
// Implements proper ETag-based concurrency for Document APIs.

const ACTIVITY_BASE = 'https://the12414.com/activities';

// ETag cache keyed by URL.
// Stores the ETag received from the last GET so PUT can send it back.
// This is how xAPI concurrency control works — we prove we're
// updating from the version we actually read.
const _etags = {};

const XApi = {

    // ── Request Headers ───────────────────────────────────────

    headers(session) {
        return {
            'Authorization': 'Basic ' + btoa(session.traxUsername + ':' + session.traxPassword),
            'Content-Type': 'application/json',
            'X-Experience-API-Version': '1.0.3',
        };
    },

    actor(session) {
        return {
            name: session.displayName,
            mbox: session.mbox,
        };
    },

    // ── Statements ────────────────────────────────────────────

    async sendStatement(session, verb, verbDisplay, activityId, activityName, options = {}) {
        const statement = this.buildStatement(
            session,
            verb,
            verbDisplay,
            activityId,
            activityName,
            options
        );

        try {
            return await fetch(session.endpoint + '/statements', {
                method: 'POST',
                headers: this.headers(session),
                body: JSON.stringify(statement),
            });
        } catch (err) {
            console.warn('xAPI statement failed:', err);
            return null;
        }
    },

    buildStatement(session, verb, verbDisplay, activityId, activityName, options = {}) {
        const statement = {
            actor: options.actor || this.actor(session),
            verb: options.verb || {
                id: options.verbId || this.verbId(verb),
                display: options.verbDisplay || { 'en-US': verbDisplay },
            },
            object: options.object || {
                id: activityId,
                objectType: options.objectType || 'Activity',
                definition: {
                    name: options.activityName || { 'en-US': activityName },
                    ...(options.activityDefinition || {}),
                },
            },
        };

        this._copyStatementOptions(statement, options);
        return statement;
    },

    verbId(verb) {
        if (verb && /^https?:\/\//i.test(verb)) return verb;
        return 'https://the12414.com/verbs/' + verb;
    },

    _copyStatementOptions(statement, options) {
        [
            'id',
            'result',
            'context',
            'timestamp',
            'stored',
            'authority',
            'version',
            'attachments',
        ].forEach(key => {
            if (options[key] !== undefined) statement[key] = options[key];
        });

        if (options.extra) {
            Object.assign(statement, options.extra);
        }
    },

    // ── Document APIs ─────────────────────────────────────────

    // GET a document. Returns parsed JSON or null if not found.
    // Captures the ETag for use in the next PUT.
    async getDocument(session, url) {
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: this.headers(session),
            });

            if (response.status === 404) {
                _etags[url] = null; // Document doesn't exist yet
                return null;
            }

            if (!response.ok) return null;

            _etags[url] = response.headers.get('ETag');
            return await response.json();

        } catch {
            return null;
        }
    },

    // PUT a document with proper concurrency headers.
    // If-None-Match: * → creating for the first time (no ETag)
    // If-Match: [etag]  → updating an existing document
    // Retries once on 412 with a fresh ETag from GET.
    async putDocument(session, url, data) {
        const headers = { ...this.headers(session) };
        const etag = _etags[url];

        if (etag) {
            headers['If-Match'] = etag;
        } else {
            headers['If-None-Match'] = '*';
        }

        let response = await fetch(url, {
            method: 'PUT',
            headers,
            body: JSON.stringify(data),
        });

        // 412 = stale ETag — refresh and retry once
        if (response.status === 412) {
            await this._refreshEtag(session, url);
            const retryHeaders = { ...this.headers(session) };
            if (_etags[url]) retryHeaders['If-Match'] = _etags[url];
            else             retryHeaders['If-None-Match'] = '*';
            response = await fetch(url, {
                method: 'PUT',
                headers: retryHeaders,
                body: JSON.stringify(data),
            });
        }

        // After success always refresh ETag via GET
        // because TRAX may not return ETag on PUT responses
        if (response.ok || response.status === 204) {
            await this._refreshEtag(session, url);
        }

        return response;
    },

    // ── URL Builders ──────────────────────────────────────────

    // Personal to-do list: State API, scoped to this user
    personalTodoUrl(session) {
        const agent = encodeURIComponent(JSON.stringify({ mbox: session.mbox }));
        return session.endpoint + '/activities/state'
            + '?activityId=' + encodeURIComponent(ACTIVITY_BASE + '/personal-todo')
            + '&agent=' + agent
            + '&stateId=personal-todos';
    },

    // Household to-do: Activity Profile API, shared across all users
    householdTodoUrl(session) {
        return session.endpoint + '/activities/profile'
            + '?activityId=' + encodeURIComponent(ACTIVITY_BASE + '/household-todo')
            + '&profileId=household-todos';
    },

    // Family calendar: Activity Profile API, shared across all users
    calendarUrl(session) {
        return session.endpoint + '/activities/profile'
            + '?activityId=' + encodeURIComponent(ACTIVITY_BASE + '/calendar')
            + '&profileId=family-calendar';
    },

    // ── ETag Refresh Helper ───────────────────────────────────
    async _refreshEtag(session, url) {
        try {
            const r = await fetch(url, {
                method: 'GET',
                headers: this.headers(session),
            });
            if (r.ok) {
                _etags[url] = r.headers.get('ETag');
            } else if (r.status === 404) {
                _etags[url] = null;
            }
        } catch { /* silently fail */ }
    },
};
