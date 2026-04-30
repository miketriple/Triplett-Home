const GAME_ACTIVITY_ID = ACTIVITY_BASE + '/games/house-dash';
const GAME_ACTIVITY_NAME = '12414 House Dash';
const GAME_STATE_ID = 'house-dash-state';
const GAME_LEADERBOARD_PROFILE_ID = 'house-dash-leaderboard';
const GAME_PROFILE_ID = ACTIVITY_BASE + '/profiles/browser-arcade-game';
const GAME_EXT_BASE = ACTIVITY_BASE + '/extensions/house-dash';

const GameXApi = {
    stateUrl(session) {
        const agent = encodeURIComponent(JSON.stringify({ mbox: session.mbox }));
        return session.endpoint + '/activities/state'
            + '?activityId=' + encodeURIComponent(GAME_ACTIVITY_ID)
            + '&agent=' + agent
            + '&stateId=' + GAME_STATE_ID;
    },

    leaderboardUrl(session) {
        return session.endpoint + '/activities/profile'
            + '?activityId=' + encodeURIComponent(GAME_ACTIVITY_ID)
            + '&profileId=' + GAME_LEADERBOARD_PROFILE_ID;
    },

    defaultPlayerState() {
        return {
            personalBest: 0,
            personalBestStatementId: null,
            lastRun: null,
            awards: {},
            totalRuns: 0,
            updatedAt: null,
        };
    },

    defaultLeaderboard() {
        return {
            topScores: [],
            recentRuns: [],
            updatedAt: null,
        };
    },

    async loadPlayerState(session) {
        const data = await XApi.getDocument(session, this.stateUrl(session));
        return { ...this.defaultPlayerState(), ...(data || {}) };
    },

    async savePlayerState(session, state) {
        state.updatedAt = new Date().toISOString();
        return XApi.putDocument(session, this.stateUrl(session), state);
    },

    async loadLeaderboard(session) {
        const data = await XApi.getDocument(session, this.leaderboardUrl(session));
        return { ...this.defaultLeaderboard(), ...(data || {}) };
    },

    async saveLeaderboard(session, leaderboard) {
        leaderboard.updatedAt = new Date().toISOString();
        return XApi.putDocument(session, this.leaderboardUrl(session), leaderboard);
    },

    async startRun(session, runId) {
        return XApi.sendStatement(
            session,
            'http://adlnet.gov/expapi/verbs/attempted',
            'attempted',
            GAME_ACTIVITY_ID,
            GAME_ACTIVITY_NAME,
            {
                activityDefinition: this.activityDefinition(),
                result: { duration: 'PT0S' },
                context: this.context(runId),
            }
        );
    },

    async enteredDeck(session, runId) {
        return XApi.sendStatement(
            session,
            'experienced',
            'experienced',
            GAME_ACTIVITY_ID + '/rooms/deck',
            'House Dash Deck',
            {
                activityDefinition: {
                    type: ACTIVITY_BASE + '/activity-types/game-room',
                    description: { 'en-US': 'The optional sunny deck bonus area.' },
                },
                context: this.context(runId, {
                    parent: [{ id: GAME_ACTIVITY_ID }],
                }),
            }
        );
    },

    async foundCat(session, runId, catName) {
        return XApi.sendStatement(
            session,
            'interacted',
            'interacted',
            GAME_ACTIVITY_ID + '/cats/' + catName.toLowerCase(),
            catName,
            {
                activityDefinition: {
                    type: ACTIVITY_BASE + '/activity-types/game-character',
                },
                context: this.context(runId, {
                    parent: [{ id: GAME_ACTIVITY_ID }],
                }),
            }
        );
    },

    async completedRun(session, runId, summary) {
        return XApi.sendStatement(
            session,
            'http://adlnet.gov/expapi/verbs/completed',
            'completed',
            GAME_ACTIVITY_ID,
            GAME_ACTIVITY_NAME,
            {
                id: summary.statementId,
                activityDefinition: this.activityDefinition(),
                result: {
                    score: {
                        raw: summary.score,
                        min: 0,
                    },
                    completion: summary.finished,
                    success: summary.finished,
                    duration: this.duration(summary.durationMs),
                    extensions: this.resultExtensions(summary),
                },
                context: this.context(runId),
            }
        );
    },

    async achievedAward(session, runId, awardId, awardName) {
        return XApi.sendStatement(
            session,
            'http://adlnet.gov/expapi/verbs/achieved',
            'achieved',
            GAME_ACTIVITY_ID + '/awards/' + awardId,
            awardName,
            {
                activityDefinition: {
                    type: ACTIVITY_BASE + '/activity-types/game-award',
                },
                context: this.context(runId, {
                    parent: [{ id: GAME_ACTIVITY_ID }],
                }),
            }
        );
    },

    async recordFinishedRun(session, profile, summary, runId) {
        const playerState = await this.loadPlayerState(session);
        const leaderboard = await this.loadLeaderboard(session);
        const displayName = profile.displayName || session.displayName;
        const now = new Date().toISOString();

        const runEntry = {
            id: runId,
            statementId: summary.statementId,
            player: displayName,
            mbox: session.mbox,
            score: summary.score,
            catsFound: summary.catsFound,
            oliverFinds: summary.oliverFinds,
            lunaFinds: summary.lunaFinds,
            sunshineAward: summary.sunshineAward,
            finished: summary.finished,
            durationMs: summary.durationMs,
            playedAt: now,
        };

        const previousBest = playerState.personalBest || 0;
        playerState.lastRun = runEntry;
        playerState.totalRuns = (playerState.totalRuns || 0) + 1;
        if (summary.score > previousBest) {
            playerState.personalBest = summary.score;
            playerState.personalBestStatementId = summary.statementId;
        }
        if (summary.sunshineAward) {
            playerState.awards = playerState.awards || {};
            playerState.awards.sunshine = playerState.awards.sunshine || {
                earned: true,
                earnedAt: now,
            };
        }

        leaderboard.recentRuns = [runEntry, ...(leaderboard.recentRuns || [])].slice(0, 10);
        leaderboard.topScores = [...(leaderboard.topScores || []), runEntry]
            .sort((a, b) => b.score - a.score || a.durationMs - b.durationMs)
            .slice(0, 10);

        await this.savePlayerState(session, playerState);
        await this.saveLeaderboard(session, leaderboard);
        return { playerState, leaderboard, personalBest: summary.score > previousBest };
    },

    activityDefinition() {
        return {
            type: 'http://activitystrea.ms/schema/1.0/game',
            description: {
                'en-US': 'A three-story townhome scroller about finding Oliver and Luna.',
            },
        };
    },

    context(runId, extra = {}) {
        const context = {
            registration: runId,
            contextActivities: {
                category: [
                    {
                        id: GAME_PROFILE_ID,
                        definition: {
                            type: ACTIVITY_BASE + '/activity-types/xapi-profile',
                        },
                    },
                ],
                grouping: [
                    { id: GAME_ACTIVITY_ID },
                ],
                ...(extra.parent ? { parent: extra.parent } : {}),
            },
        };
        return context;
    },

    resultExtensions(summary) {
        return {
            [GAME_EXT_BASE + '/cats-found']: summary.catsFound,
            [GAME_EXT_BASE + '/oliver-finds']: summary.oliverFinds,
            [GAME_EXT_BASE + '/luna-finds']: summary.lunaFinds,
            [GAME_EXT_BASE + '/cat-chaos-events']: summary.catChaosEvents,
            [GAME_EXT_BASE + '/rooms-visited']: summary.roomsVisited,
            [GAME_EXT_BASE + '/floors-visited']: summary.floorsVisited,
            [GAME_EXT_BASE + '/deck-visited']: summary.deckVisited,
            [GAME_EXT_BASE + '/sunshine-award']: summary.sunshineAward,
            [GAME_EXT_BASE + '/finish-location']: summary.finishLocation,
        };
    },

    duration(ms) {
        const totalSeconds = Math.max(0, Math.round(ms / 1000));
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return 'PT' + (minutes ? minutes + 'M' : '') + seconds + 'S';
    },
};
