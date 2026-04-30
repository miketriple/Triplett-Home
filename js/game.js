const HouseDash = (() => {
    const canvasId = 'house-dash-canvas';
    const view = { w: 960, h: 540 };
    const groundY = 425;
    const playerSize = { w: 34, h: 54 };
    const gravity = 0.72;
    const jumpPower = -15;
    const runSpeed = 5.4;
    const keys = {};

    let session = null;
    let profile = null;
    let canvas = null;
    let ctx = null;
    let overlay = null;
    let running = false;
    let runId = null;
    let runStart = 0;
    let rafId = null;
    let playerState = null;
    let leaderboard = null;
    let state = null;

    const levels = buildLevels();

    function init(activeSession, activeProfile) {
        session = activeSession;
        profile = activeProfile;
        canvas = document.getElementById(canvasId);
        ctx = canvas.getContext('2d');
        overlay = document.getElementById('game-overlay');

        wireInput();
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
        document.getElementById('game-start-btn').addEventListener('click', startRun);

        loadArcadeData();
        resetState();
        draw();
    }

    async function loadArcadeData() {
        playerState = await GameXApi.loadPlayerState(session);
        leaderboard = await GameXApi.loadLeaderboard(session);
        document.getElementById('game-best').textContent = playerState.personalBest || 0;
        renderLists();
    }

    function startRun() {
        runId = crypto.randomUUID();
        runStart = performance.now();
        running = true;
        resetState();
        overlay.classList.remove('show');
        overlay.style.display = 'none';
        GameXApi.startRun(session, runId);
        loop();
    }

    function resetState() {
        const collectedIds = new Set();
        state = {
            mode: 'house',
            levelIndex: 0,
            deckReturn: null,
            cameraX: 0,
            score: 0,
            hearts: 3,
            invulnerable: 0,
            message: 'Find Oliver and Luna',
            prompt: '',
            roomsVisited: new Set(),
            floorsVisited: new Set([1]),
            deckVisited: false,
            sunshineAward: false,
            catChaosEvents: 0,
            foundCats: [],
            collectedIds,
            player: {
                x: 50,
                y: groundY - playerSize.h,
                vx: 0,
                vy: 0,
                w: playerSize.w,
                h: playerSize.h,
                grounded: true,
                facing: 1,
            },
            entities: cloneEntities(levels[0], collectedIds),
        };
        updateHud();
    }

    function loop() {
        if (!running) return;
        step();
        draw();
        rafId = requestAnimationFrame(loop);
    }

    function step() {
        const player = state.player;
        const level = currentLevel();

        player.vx = 0;
        if (keys.ArrowLeft || keys.a) player.vx -= runSpeed;
        if (keys.ArrowRight || keys.d) player.vx += runSpeed;
        if (player.vx !== 0) player.facing = player.vx > 0 ? 1 : -1;
        if ((keys.Space || keys.ArrowUp || keys.w) && player.grounded) jump();

        player.vy += gravity;
        player.x += player.vx;
        player.y += player.vy;

        if (player.y + player.h >= groundY) {
            player.y = groundY - player.h;
            player.vy = 0;
            player.grounded = true;
        }

        player.x = Math.max(12, Math.min(level.width - player.w - 12, player.x));
        updateCamera(level);
        updateRoomTracking(level);
        updateEntities();
        handleDoorAndStairs(level);
        if (state.invulnerable > 0) state.invulnerable -= 1;
        updateHud();
    }

    function jump() {
        state.player.vy = jumpPower;
        state.player.grounded = false;
    }

    function updateCamera(level) {
        const target = state.player.x - view.w * 0.42;
        state.cameraX += (target - state.cameraX) * 0.12;
        state.cameraX = Math.max(0, Math.min(level.width - view.w, state.cameraX));
    }

    function updateRoomTracking(level) {
        const room = roomAt(level, state.player.x);
        if (!room) return;
        const key = level.floor + ':' + room.name;
        if (!state.roomsVisited.has(key)) {
            state.roomsVisited.add(key);
            state.message = room.name;
        }
    }

    function updateEntities() {
        for (const entity of state.entities) {
            if (entity.hit) continue;
            if (entity.kind === 'hazard' && entity.motion) {
                entity.x += entity.motion.speed * entity.motion.dir;
                if (entity.x < entity.motion.min || entity.x > entity.motion.max) {
                    entity.motion.dir *= -1;
                }
            }

            if (!intersects(state.player, entity)) continue;

            if (entity.kind === 'cat') {
                collectCat(entity);
            } else if (entity.kind === 'hazard') {
                hitHazard(entity);
            } else if (entity.kind === 'award') {
                collectSunshineAward(entity);
            }
        }
    }

    function collectCat(cat) {
        cat.hit = true;
        state.collectedIds.add(cat.id);
        const helpful = cat.cat === 'Oliver';
        const points = cat.value || (helpful ? 250 : 400);
        state.score += points;
        state.foundCats.push(cat.cat);
        state.message = cat.cat + ' found +' + points;
        if (helpful) {
            state.invulnerable = Math.max(state.invulnerable, 130);
        } else {
            state.catChaosEvents += 1;
        }
        GameXApi.foundCat(session, runId, cat.cat);
    }

    function hitHazard(hazard) {
        if (state.invulnerable > 0) return;
        state.hearts -= 1;
        state.invulnerable = 110;
        state.message = hazard.label || 'Ouch';
        state.player.vx = -state.player.facing * 6;
        state.player.vy = -8;
        state.player.grounded = false;
        if (state.hearts <= 0) finishRun(false);
    }

    function collectSunshineAward(award) {
        award.hit = true;
        state.collectedIds.add(award.id);
        state.score += 1200;
        state.sunshineAward = true;
        state.message = 'Sunshine Award +1200';
        GameXApi.achievedAward(session, runId, 'sunshine', 'Sunshine Award');
    }

    function handleDoorAndStairs(level) {
        state.prompt = '';
        const player = state.player;

        if (level.deckDoor && nearX(player, level.deckDoor.x, 58) && state.mode === 'house') {
            state.prompt = 'Press E or Up to visit the deck';
            if (consumeAction()) enterDeck();
            return;
        }

        if (level.exitDoor && nearX(player, level.exitDoor.x, 68) && state.mode === 'deck') {
            state.prompt = 'Press E or Up to return inside';
            if (consumeAction()) exitDeck();
            return;
        }

        if (level.finish && nearX(player, level.finish.x, 74)) {
            state.prompt = 'Press E or Up to open attic access';
            if (consumeAction()) finishRun(true);
            return;
        }

        if (level.stairs && nearX(player, level.stairs.x, 70)) {
            state.prompt = 'Press E or Up for stairs';
            if (consumeAction()) nextFloor();
        }
    }

    function consumeAction() {
        if (keys.e || keys.Enter || keys.ArrowUp || keys.w) {
            keys.e = false;
            keys.Enter = false;
            keys.ArrowUp = false;
            keys.w = false;
            return true;
        }
        return false;
    }

    function enterDeck() {
        const kitchenLevel = currentLevel();
        state.deckReturn = {
            levelIndex: state.levelIndex,
            x: kitchenLevel.deckDoor.x + 70,
        };
        state.mode = 'deck';
        state.deckVisited = true;
        state.levelIndex = 3;
        state.player.x = 70;
        state.player.y = groundY - state.player.h;
        state.player.vx = 0;
        state.player.vy = 0;
        state.cameraX = 0;
        state.entities = cloneEntities(levels[3], state.collectedIds);
        state.message = 'Sunny deck';
        GameXApi.enteredDeck(session, runId);
    }

    function exitDeck() {
        state.mode = 'house';
        state.levelIndex = state.deckReturn.levelIndex;
        state.player.x = state.deckReturn.x;
        state.player.y = groundY - state.player.h;
        state.player.vx = 0;
        state.player.vy = 0;
        state.cameraX = Math.max(0, state.player.x - view.w * 0.42);
        state.entities = cloneEntities(levels[state.levelIndex], state.collectedIds);
        state.message = 'Back to kitchen';
    }

    function nextFloor() {
        if (state.levelIndex >= 2) return;
        state.levelIndex += 1;
        state.mode = 'house';
        state.player.x = 55;
        state.player.y = groundY - state.player.h;
        state.player.vx = 0;
        state.player.vy = 0;
        state.cameraX = 0;
        state.entities = cloneEntities(levels[state.levelIndex], state.collectedIds);
        state.floorsVisited.add(currentLevel().floor);
        state.message = 'Floor ' + currentLevel().floor;
    }

    async function finishRun(finished) {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        const summary = buildSummary(finished);
        summary.statementId = crypto.randomUUID();
        await GameXApi.completedRun(session, runId, summary);
        const result = await GameXApi.recordFinishedRun(session, profile, summary, runId);
        playerState = result.playerState;
        leaderboard = result.leaderboard;
        renderLists();
        document.getElementById('game-best').textContent = playerState.personalBest || 0;

        overlay.style.display = 'flex';
        overlay.classList.add('show');
        overlay.innerHTML = `
            <h3>${finished ? 'Attic Access Reached' : 'Run Ended'}</h3>
            <p>Score ${summary.score} · Cats ${summary.catsFound} · ${summary.sunshineAward ? 'Sunshine Award' : 'No secret award'}</p>
            <button class="btn btn-primary" id="game-start-btn">Run Again</button>
        `;
        document.getElementById('game-start-btn').addEventListener('click', startRun);
        draw();
    }

    function buildSummary(finished) {
        const catsFound = state.foundCats.length;
        return {
            score: state.score,
            finished,
            durationMs: Math.round(performance.now() - runStart),
            catsFound,
            oliverFinds: state.foundCats.filter(name => name === 'Oliver').length,
            lunaFinds: state.foundCats.filter(name => name === 'Luna').length,
            catChaosEvents: state.catChaosEvents,
            roomsVisited: state.roomsVisited.size,
            floorsVisited: state.floorsVisited.size,
            deckVisited: state.deckVisited,
            sunshineAward: state.sunshineAward,
            finishLocation: finished ? 'attic-access' : 'house',
        };
    }

    function draw() {
        if (!ctx || !state) return;
        const level = currentLevel();
        ctx.clearRect(0, 0, view.w, view.h);
        drawBackground(level);
        drawRooms(level);
        drawFurniture(level);
        drawEntities();
        drawPlayer();
        drawForeground(level);
        drawPrompt();
    }

    function drawBackground(level) {
        const gradient = ctx.createLinearGradient(0, 0, 0, view.h);
        if (level.floor === 'deck') {
            gradient.addColorStop(0, '#a7d8ff');
            gradient.addColorStop(1, '#e8f8d8');
        } else {
            gradient.addColorStop(0, '#f7efe5');
            gradient.addColorStop(1, '#e7ddd0');
        }
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, view.w, view.h);
        ctx.fillStyle = '#6b4f3a';
        ctx.fillRect(0, groundY, view.w, 20);
        ctx.fillStyle = '#4f3828';
        ctx.fillRect(0, groundY + 20, view.w, view.h - groundY - 20);
    }

    function drawRooms(level) {
        let x = -state.cameraX;
        level.rooms.forEach((room, index) => {
            ctx.fillStyle = room.color;
            ctx.fillRect(x, 80, room.length, groundY - 80);
            ctx.fillStyle = 'rgba(255,255,255,0.24)';
            ctx.fillRect(x + 20, 105, room.length - 40, 24);
            ctx.fillStyle = '#5b4636';
            ctx.font = '700 18px -apple-system, Segoe UI, sans-serif';
            ctx.fillText(room.name, x + 28, 124);
            if (index > 0) {
                ctx.fillStyle = '#7b6048';
                ctx.fillRect(x - 5, 92, 10, groundY - 92);
            }
            x += room.length;
        });
    }

    function drawFurniture(level) {
        for (const item of level.furniture) {
            const x = item.x - state.cameraX;
            if (x < -120 || x > view.w + 120) continue;
            ctx.save();
            ctx.fillStyle = item.color || '#76543c';
            ctx.strokeStyle = 'rgba(0,0,0,0.18)';
            ctx.lineWidth = 2;
            roundRect(x, item.y, item.w, item.h, 8, true, true);
            ctx.fillStyle = 'rgba(255,255,255,0.42)';
            ctx.fillRect(x + 8, item.y + 8, Math.max(8, item.w - 16), 5);
            ctx.fillStyle = '#4b382a';
            ctx.font = '600 12px -apple-system, Segoe UI, sans-serif';
            ctx.fillText(item.label, x + 9, item.y + item.h - 10);
            ctx.restore();
        }

        if (level.stairs) drawStairs(level.stairs.x - state.cameraX);
        if (level.deckDoor) drawDoor(level.deckDoor.x - state.cameraX, 'Deck');
        if (level.exitDoor) drawDoor(level.exitDoor.x - state.cameraX, 'Kitchen');
        if (level.finish) drawAttic(level.finish.x - state.cameraX);
    }

    function drawEntities() {
        for (const entity of state.entities) {
            if (entity.hit) continue;
            const x = entity.x - state.cameraX;
            if (x < -80 || x > view.w + 80) continue;
            if (entity.kind === 'cat') drawCat(x, entity.y, entity.cat, entity.pose);
            if (entity.kind === 'hazard') drawHazard(x, entity.y, entity);
            if (entity.kind === 'award') drawSunshineAward(x, entity.y);
        }
    }

    function drawPlayer() {
        const p = state.player;
        const x = p.x - state.cameraX;
        ctx.save();
        if (state.invulnerable > 0 && Math.floor(state.invulnerable / 8) % 2 === 0) {
            ctx.globalAlpha = 0.55;
        }
        ctx.fillStyle = '#2d6a4f';
        roundRect(x, p.y, p.w, p.h, 10, true, false);
        ctx.fillStyle = '#f2c7a5';
        ctx.beginPath();
        ctx.arc(x + p.w / 2, p.y + 10, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1b4332';
        ctx.fillRect(x + 8, p.y + 26, 18, 20);
        ctx.fillStyle = '#263238';
        ctx.fillRect(x + (p.facing > 0 ? 22 : 4), p.y + 16, 5, 3);
        ctx.restore();
    }

    function drawForeground(level) {
        ctx.fillStyle = 'rgba(255,255,255,0.82)';
        roundRect(16, 16, 215, 36, 18, true, false);
        ctx.fillStyle = '#4b382a';
        ctx.font = '700 14px -apple-system, Segoe UI, sans-serif';
        ctx.fillText('Floor ' + level.floor + ' · ' + (state.message || ''), 32, 39);
    }

    function drawPrompt() {
        if (!state.prompt) return;
        ctx.fillStyle = 'rgba(27, 67, 50, 0.92)';
        roundRect(view.w / 2 - 150, 56, 300, 36, 18, true, false);
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 14px -apple-system, Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(state.prompt, view.w / 2, 79);
        ctx.textAlign = 'left';
    }

    function drawStairs(x) {
        ctx.fillStyle = '#8a6748';
        for (let i = 0; i < 6; i += 1) {
            ctx.fillRect(x + i * 18, groundY - 20 - i * 17, 90, 15);
        }
        ctx.fillStyle = '#4b382a';
        ctx.font = '700 12px -apple-system, Segoe UI, sans-serif';
        ctx.fillText('Stairs', x + 26, groundY - 126);
    }

    function drawDoor(x, label) {
        ctx.fillStyle = '#744c2e';
        ctx.fillRect(x, groundY - 112, 58, 112);
        ctx.fillStyle = '#f4d06f';
        ctx.beginPath();
        ctx.arc(x + 45, groundY - 55, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4b382a';
        ctx.font = '700 12px -apple-system, Segoe UI, sans-serif';
        ctx.fillText(label, x + 8, groundY - 122);
    }

    function drawAttic(x) {
        ctx.fillStyle = '#6b4f3a';
        roundRect(x, groundY - 158, 92, 72, 8, true, true);
        ctx.fillStyle = '#f4d06f';
        ctx.fillRect(x + 12, groundY - 146, 68, 10);
        ctx.fillStyle = '#4b382a';
        ctx.font = '700 12px -apple-system, Segoe UI, sans-serif';
        ctx.fillText('Attic Access', x - 2, groundY - 170);
    }

    function drawHazard(x, y, hazard) {
        ctx.save();
        ctx.fillStyle = hazard.color || '#c2410c';
        if (hazard.shape === 'puddle') {
            ctx.beginPath();
            ctx.ellipse(x + hazard.w / 2, y + hazard.h / 2, hazard.w / 2, hazard.h / 2, 0, 0, Math.PI * 2);
            ctx.fill();
        } else if (hazard.shape === 'sound') {
            ctx.strokeStyle = hazard.color || '#c1121f';
            ctx.lineWidth = 5;
            for (let i = 0; i < 3; i += 1) {
                ctx.beginPath();
                ctx.arc(x, y + hazard.h / 2, 18 + i * 16, -0.8, 0.8);
                ctx.stroke();
            }
        } else {
            roundRect(x, y, hazard.w, hazard.h, 7, true, false);
        }
        ctx.fillStyle = '#4b382a';
        ctx.font = '600 11px -apple-system, Segoe UI, sans-serif';
        if (hazard.label) ctx.fillText(hazard.label, x, y - 5);
        ctx.restore();
    }

    function drawCat(x, y, name, pose) {
        const oliver = name === 'Oliver';
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = oliver ? '#7b8490' : '#3a2a22';
        const bodyW = oliver ? 44 : 42;
        const bodyH = oliver ? 28 : 34;
        if (pose === 'sleep') {
            ctx.beginPath();
            ctx.ellipse(24, 24, bodyW / 2, bodyH / 2, 0, 0, Math.PI * 2);
            ctx.fill();
            if (!oliver) {
                ctx.fillStyle = '#5a3c2c';
                ctx.beginPath();
                ctx.ellipse(25, 24, 28, 20, 0, 0, Math.PI * 2);
                ctx.fill();
            }
        } else {
            roundRect(6, 16, bodyW, bodyH, 14, true, false);
        }
        ctx.fillStyle = oliver ? '#8c96a3' : '#4a3428';
        ctx.beginPath();
        ctx.arc(17, 12, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(8, 4);
        ctx.lineTo(13, -8);
        ctx.lineTo(18, 4);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(21, 4);
        ctx.lineTo(26, -8);
        ctx.lineTo(31, 4);
        ctx.fill();
        ctx.strokeStyle = oliver ? '#7b8490' : '#4a3428';
        ctx.lineWidth = oliver ? 5 : 8;
        ctx.beginPath();
        ctx.arc(48, 20, 18, -0.7, 1.8);
        ctx.stroke();
        ctx.fillStyle = oliver ? '#55d17a' : '#f1d08a';
        ctx.beginPath();
        ctx.arc(13, 11, 2.5, 0, Math.PI * 2);
        ctx.arc(22, 11, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 11px -apple-system, Segoe UI, sans-serif';
        ctx.fillText(name, -2, -14);
        ctx.restore();
    }

    function drawSunshineAward(x, y) {
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = '#f4d06f';
        ctx.beginPath();
        ctx.arc(28, 22, 26, 0, Math.PI * 2);
        ctx.fill();
        drawCat(2, 12, 'Oliver', 'sleep');
        drawCat(36, 14, 'Luna', 'sleep');
        ctx.restore();
    }

    function updateHud() {
        document.getElementById('game-score').textContent = state.score;
        document.getElementById('game-hearts').textContent = state.hearts;
        document.getElementById('game-floor').textContent = currentLevel().floor;
    }

    function renderLists() {
        renderRunList('game-recent', leaderboard?.recentRuns || [], 'No runs yet.');
        renderRunList('game-leaderboard', leaderboard?.topScores || [], 'No scores yet.');
    }

    function renderRunList(id, runs, emptyText) {
        const el = document.getElementById(id);
        if (!el) return;
        if (!runs.length) {
            el.className = 'game-list muted';
            el.textContent = emptyText;
            return;
        }
        el.className = 'game-list';
        el.innerHTML = runs.slice(0, 5).map((run, index) => `
            <div class="game-list-row">
                <span>${index + 1}. ${App.escapeHtml(run.player || 'Player')}</span>
                <strong>${run.score || 0}${run.sunshineAward ? ' *' : ''}</strong>
            </div>
        `).join('');
    }

    function currentLevel() {
        return levels[state.levelIndex];
    }

    function cloneEntities(level, collectedIds = state?.collectedIds) {
        return level.entities.map(entity => ({
            ...entity,
            motion: entity.motion ? { ...entity.motion } : null,
            hit: collectedIds?.has(entity.id) || false,
        }));
    }

    function roomAt(level, x) {
        let cursor = 0;
        for (const room of level.rooms) {
            if (x >= cursor && x < cursor + room.length) return room;
            cursor += room.length;
        }
        return level.rooms[level.rooms.length - 1];
    }

    function nearX(player, x, distance) {
        return Math.abs((player.x + player.w / 2) - x) < distance;
    }

    function intersects(a, b) {
        return a.x < b.x + b.w
            && a.x + a.w > b.x
            && a.y < b.y + b.h
            && a.y + a.h > b.y;
    }

    function resizeCanvas() {
        const wrap = canvas.parentElement;
        const width = Math.min(960, wrap.clientWidth);
        const height = Math.round(width * 0.5625);
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
    }

    function wireInput() {
        window.addEventListener('keydown', event => {
            keys[event.key] = true;
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', ' ', 'Space'].includes(event.key)) {
                event.preventDefault();
            }
            if (event.key === ' ') keys.Space = true;
        });
        window.addEventListener('keyup', event => {
            keys[event.key] = false;
            if (event.key === ' ') keys.Space = false;
        });

        bindHold('btn-left', 'ArrowLeft');
        bindHold('btn-right', 'ArrowRight');
        bindHold('btn-jump', 'Space');
        bindHold('btn-action', 'e');
    }

    function bindHold(id, key) {
        const btn = document.getElementById(id);
        if (!btn) return;
        const on = event => {
            event.preventDefault();
            keys[key] = true;
        };
        const off = event => {
            event.preventDefault();
            keys[key] = false;
        };
        btn.addEventListener('pointerdown', on);
        btn.addEventListener('pointerup', off);
        btn.addEventListener('pointerleave', off);
        btn.addEventListener('pointercancel', off);
    }

    function roundRect(x, y, w, h, r, fill, stroke) {
        const radius = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + w - radius, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
        ctx.lineTo(x + w, y + h - radius);
        ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
        ctx.lineTo(x + radius, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        if (fill) ctx.fill();
        if (stroke) ctx.stroke();
    }

    function buildLevels() {
        const floor1 = makeLevel(1, [
            room('Entry', 420, '#efe2d0'),
            room('Rec Room', 900, '#dfebf2'),
            room('Gym', 560, '#e3ecd9'),
            room('Full Bath', 420, '#d8edf0'),
            room('Stairs', 260, '#ead8c4'),
        ], [
            furniture(110, 365, 100, 50, 'bench', '#9c7553'),
            furniture(540, 345, 170, 80, 'tv', '#425466'),
            furniture(790, 350, 95, 75, 'desk', '#6d4c41'),
            furniture(1020, 360, 100, 65, 'amp', '#3d405b'),
            furniture(1435, 370, 120, 55, 'mat', '#40916c'),
            furniture(1680, 360, 85, 65, 'weights', '#475569'),
            furniture(2000, 350, 88, 75, 'sink', '#6fb1c7'),
        ], [
            cat(240, 'Oliver', 250, 'stand'),
            hazard(620, 386, 52, 38, 'controller', '#c2410c'),
            hazard(1045, 334, 38, 80, 'sound', '#c1121f', 'sound'),
            cat(1260, 'Luna', 450, 'stand', { min: 1210, max: 1360, speed: 1.7 }),
            hazard(1610, 385, 70, 34, 'ball', '#ef4444'),
            cat(1880, 'Oliver', 300, 'sleep'),
            hazard(2110, 396, 92, 20, 'puddle', '#38bdf8', 'puddle'),
        ], { stairsX: 2440 });

        const floor2 = makeLevel(2, [
            room('Living Room', 760, '#f0e7d8'),
            room('Dining Area', 560, '#ece0cf'),
            room('Kitchen', 800, '#e4efdf'),
            room('Half Bath', 380, '#d9edf2'),
            room('Stairs', 260, '#ead8c4'),
        ], [
            furniture(120, 346, 175, 78, 'couch', '#7f5539'),
            furniture(365, 368, 120, 55, 'ottoman', '#b08968'),
            furniture(540, 335, 150, 88, 'tv', '#425466'),
            furniture(860, 352, 210, 70, 'bar table', '#9c6644'),
            furniture(1390, 352, 170, 72, 'island', '#6b8f71'),
            furniture(1650, 336, 210, 86, 'counter', '#8a817c'),
            furniture(2255, 352, 92, 72, 'sink', '#6fb1c7'),
        ], [
            cat(250, 'Oliver', 300, 'sleep'),
            hazard(455, 384, 74, 34, 'remote', '#334155'),
            cat(900, 'Luna', 500, 'stand', { min: 860, max: 1050, speed: 2.2 }),
            hazard(1140, 370, 45, 54, 'chair', '#c2410c'),
            hazard(1515, 390, 50, 32, 'can', '#ef4444', null, { min: 1440, max: 1660, speed: 2.4 }),
            cat(1800, 'Oliver', 350, 'stand'),
            hazard(2270, 396, 90, 20, 'puddle', '#38bdf8', 'puddle'),
        ], { stairsX: 2600, deckDoorX: 1885 });

        const floor3 = makeLevel(3, [
            room('Bedroom 1', 560, '#eadde7'),
            room('Bedroom 2', 560, '#e0e9f4'),
            room('Full Bath', 390, '#d9edf2'),
            room('Master Bedroom', 680, '#eee0d2'),
            room('Master Bath', 430, '#d9edf2'),
            room('Walk-in Closet', 430, '#e7dccb'),
        ], [
            furniture(120, 352, 180, 70, 'bed', '#b5838d'),
            furniture(700, 356, 170, 68, 'desk', '#6d597a'),
            furniture(1210, 350, 82, 74, 'sink', '#6fb1c7'),
            furniture(1630, 348, 220, 75, 'bed', '#9c6644'),
            furniture(2320, 350, 95, 74, 'vanity', '#6fb1c7'),
            furniture(2705, 350, 130, 72, 'closet', '#7f5539'),
        ], [
            cat(210, 'Luna', 500, 'sleep'),
            hazard(360, 384, 84, 38, 'laundry', '#8b5cf6'),
            cat(790, 'Oliver', 300, 'stand'),
            hazard(960, 388, 70, 34, 'books', '#c2410c'),
            hazard(1290, 396, 90, 20, 'puddle', '#38bdf8', 'puddle'),
            cat(1780, 'Luna', 550, 'stand', { min: 1680, max: 1880, speed: 2.4 }),
            hazard(2325, 396, 95, 20, 'steam', '#38bdf8', 'puddle'),
            cat(2720, 'Oliver', 500, 'sleep'),
        ], { finishX: 2920 });

        const deck = makeLevel('deck', [
            room('Sunny Deck', 820, '#dff1ce'),
        ], [
            furniture(120, 350, 135, 72, 'chair', '#9c7553'),
            furniture(520, 360, 155, 62, 'planters', '#588157'),
        ], [
            cat(270, 'Oliver', 550, 'sleep'),
            cat(350, 'Luna', 650, 'sleep'),
            award(440),
        ], { exitDoorX: 745 });

        return [floor1, floor2, floor3, deck];
    }

    function makeLevel(floor, rooms, furniture, entities, options = {}) {
        const width = rooms.reduce((sum, item) => sum + item.length, 0);
        return {
            floor,
            rooms,
            furniture,
            entities,
            width,
            stairs: options.stairsX ? { x: options.stairsX } : null,
            deckDoor: options.deckDoorX ? { x: options.deckDoorX } : null,
            exitDoor: options.exitDoorX ? { x: options.exitDoorX } : null,
            finish: options.finishX ? { x: options.finishX } : null,
        };
    }

    function room(name, length, color) {
        return { name, length, color };
    }

    function furniture(x, y, w, h, label, color) {
        return { x, y, w, h, label, color };
    }

    function cat(x, catName, value, pose, motion) {
        return {
            id: 'cat-' + catName + '-' + x,
            kind: 'cat',
            cat: catName,
            pose,
            value,
            x,
            y: groundY - 56,
            w: 64,
            h: 56,
            motion: motion ? { ...motion, dir: 1 } : null,
        };
    }

    function hazard(x, y, w, h, label, color, shape, motion) {
        return {
            kind: 'hazard',
            x,
            y,
            w,
            h,
            label,
            color,
            shape,
            motion: motion ? { ...motion, dir: 1 } : null,
        };
    }

    function award(x) {
        return {
            id: 'award-sunshine-' + x,
            kind: 'award',
            x,
            y: groundY - 88,
            w: 96,
            h: 78,
        };
    }

    return { init };
})();
