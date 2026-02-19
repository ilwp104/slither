// ============================================================
//  Slither.io Clone — Client (Optimized: no shadowBlur)
// ============================================================

const canvas   = document.getElementById('gameCanvas');
const ctx      = canvas.getContext('2d');
const mmCanvas = document.getElementById('minimap');
const mmCtx    = mmCanvas.getContext('2d');

const startScreen   = document.getElementById('startScreen');
const nameInput     = document.getElementById('nameInput');
const playBtn       = document.getElementById('playBtn');
const hudEl         = document.getElementById('hud');
const scoreEl       = document.getElementById('score');
const lbList        = document.getElementById('lbList');
const gameOverEl    = document.getElementById('gameOver');
const finalScoreEl  = document.getElementById('finalScore');
const retryBtn      = document.getElementById('retryBtn');
const onlineCountEl = document.getElementById('onlineCount');
const pingEl        = document.getElementById('ping');
const homeBtn       = document.getElementById('homeBtn');
const highScoreStartEl = document.getElementById('highScoreStart');
const highScoreOverEl  = document.getElementById('highScoreOver');

// --- State ---
let ws = null;
let myId = null;
let worldSize = 6000;
let palettes = [];
let stateSnakes = [];
let stateFoods  = [];
let minimapData = []; // all snakes [x, y, paletteIdx, isPlayer]
let camera = { x: 3000, y: 3000, zoom: 1 };
let mouse = { x: 0, y: 0 };
let isBoosting = false;
let connected = false;
let playing = false;
let playerName = 'Player';
let highScore = parseInt(localStorage.getItem('highScore')) || 0;
const GRID_SIZE = 80;

// ============================================================
//  Connection
// ============================================================
function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.onopen = () => { connected = true; };
    ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.t === 'w') {
            myId = msg.id;
            worldSize = msg.ws;
            palettes = msg.p;
            playing = true;
            startScreen.style.display = 'none';
            gameOverEl.style.display = 'none';
            hudEl.style.display = 'block';
            document.body.style.cursor = 'none';
        }
        if (msg.t === 's') {
            // Decode compact snake array
            stateSnakes = msg.s.map(s => {
                const segs = [];
                for (let i = 0; i < s[2].length; i += 2)
                    segs.push(s[2][i], s[2][i+1]);
                return {
                    id: s[0], name: s[1], segs, pal: s[3],
                    len: s[4], angle: s[5], boost: s[6], score: s[7],
                    isMe: s[0] === msg.y,
                };
            });
            // Decode compact food array
            stateFoods = msg.f; // [[x,y,color,radius], ...]
            if (msg.mm) minimapData = msg.mm; // [[x,y,pal,isPlayer], ...]

            // Camera
            const me = stateSnakes.find(s => s.isMe);
            if (me && me.segs.length >= 2) {
                camera.x += (me.segs[0] - camera.x) * 0.15;
                camera.y += (me.segs[1] - camera.y) * 0.15;
                const tz = Math.max(0.45, 1 - me.len * 0.0008);
                camera.zoom += (tz - camera.zoom) * 0.03;
            }

            // Global leaderboard from server
            if (msg.lb) {
                let html = '';
                for (let i = 0; i < msg.lb.length; i++) {
                    const e = msg.lb[i]; // [id, name, score, paletteIdx]
                    const cls = e[0] === msg.y ? 'lb-entry me' : 'lb-entry';
                    html += `<div class="${cls}"><span>${i+1}. ${esc(e[1])}</span><span>${e[2]}</span></div>`;
                }
                lbList.innerHTML = html;
            }
            if (me) scoreEl.textContent = `Score: ${me.score}  |  Length: ${me.len}`;
            const pc = stateSnakes.filter(s => s.id.startsWith('p_')).length;
            onlineCountEl.textContent = `${pc} player(s) online`;
        }
        if (msg.t === 'd') {
            playing = false;
            finalScoreEl.textContent = `Score: ${msg.sc}  |  Length: ${msg.l}`;
            if (msg.sc > highScore) {
                highScore = msg.sc;
                localStorage.setItem('highScore', highScore);
            }
            highScoreOverEl.textContent = `Best: ${highScore}`;
            setTimeout(() => {
                gameOverEl.style.display = 'flex';
                document.body.style.cursor = 'default';
            }, 600);
        }
    };
    ws.onclose = () => { connected = false; setTimeout(connect, 2000); };
}

// ============================================================
//  Input
// ============================================================
canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener('mousedown', () => { isBoosting = true; });
window.addEventListener('mouseup',   () => { isBoosting = false; });
window.addEventListener('keydown', (e) => { if (e.code === 'Space') { isBoosting = true; e.preventDefault(); } });
window.addEventListener('keyup',   (e) => { if (e.code === 'Space') isBoosting = false; });

setInterval(() => {
    if (!ws || ws.readyState !== 1 || !playing) return;
    const a = Math.atan2(mouse.y - canvas.height / 2, mouse.x - canvas.width / 2);
    ws.send(JSON.stringify({ type: 'input', a, b: isBoosting }));
}, 50);

playBtn.addEventListener('click', joinGame);
retryBtn.addEventListener('click', respawnGame);
homeBtn.addEventListener('click', goHome);
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame(); });
function joinGame() {
    playerName = nameInput.value.trim() || 'Player';
    if (!connected) { connect(); setTimeout(joinGame, 500); return; }
    ws.send(JSON.stringify({ type: 'join', name: playerName }));
}
function respawnGame() {
    gameOverEl.style.display = 'none';
    if (!connected) { connect(); setTimeout(respawnGame, 500); return; }
    ws.send(JSON.stringify({ type: 'respawn', name: playerName }));
}
function goHome() {
    playing = false;
    hudEl.style.display = 'none';
    gameOverEl.style.display = 'none';
    startScreen.style.display = 'flex';
    document.body.style.cursor = 'default';
    highScoreStartEl.textContent = highScore > 0 ? `Best: ${highScore}` : '';
    if (ws && ws.readyState === 1) ws.close();
}

// ============================================================
//  Render Loop
// ============================================================
function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function loop() {
    render();
    requestAnimationFrame(loop);
}

function render() {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.save();

    const z = camera.zoom;
    ctx.translate(w / 2, h / 2);
    ctx.scale(z, z);
    ctx.translate(-camera.x, -camera.y);

    drawBackground(z);
    drawBoundary();
    drawFoods();
    drawSnakes();

    ctx.restore();
    drawCursor();
    drawMinimap();
}

// ============================================================
//  Drawing — no shadowBlur anywhere
// ============================================================
function drawBackground(z) {
    const halfW = canvas.width / z / 2 + GRID_SIZE;
    const halfH = canvas.height / z / 2 + GRID_SIZE;
    const sx = Math.floor((camera.x - halfW) / GRID_SIZE) * GRID_SIZE;
    const sy = Math.floor((camera.y - halfH) / GRID_SIZE) * GRID_SIZE;
    const ex = camera.x + halfW;
    const ey = camera.y + halfH;

    ctx.fillStyle = '#0a0a2e';
    ctx.fillRect(Math.max(0, sx), Math.max(0, sy),
        Math.min(worldSize, ex) - Math.max(0, sx),
        Math.min(worldSize, ey) - Math.max(0, sy));

    ctx.strokeStyle = 'rgba(60,60,120,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = sx; x <= ex; x += GRID_SIZE) {
        if (x < 0 || x > worldSize) continue;
        ctx.moveTo(x, Math.max(0, sy));
        ctx.lineTo(x, Math.min(worldSize, ey));
    }
    for (let y = sy; y <= ey; y += GRID_SIZE) {
        if (y < 0 || y > worldSize) continue;
        ctx.moveTo(Math.max(0, sx), y);
        ctx.lineTo(Math.min(worldSize, ex), y);
    }
    ctx.stroke();
}

function drawBoundary() {
    ctx.strokeStyle = '#ff4757';
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, worldSize, worldSize);
    // Simple inner glow line
    ctx.strokeStyle = 'rgba(255,71,87,0.3)';
    ctx.lineWidth = 18;
    ctx.strokeRect(0, 0, worldSize, worldSize);
}

function drawFoods() {
    // Batch by color for fewer state changes
    const byColor = {};
    for (let i = 0; i < stateFoods.length; i++) {
        const f = stateFoods[i];
        const c = f[2];
        if (!byColor[c]) byColor[c] = [];
        byColor[c].push(f);
    }
    for (const color in byColor) {
        const arr = byColor[color];
        // Outer glow circle (lighter, slightly bigger)
        ctx.fillStyle = color + '44'; // 27% alpha
        ctx.beginPath();
        for (let i = 0; i < arr.length; i++) {
            const f = arr[i];
            ctx.moveTo(f[0] + f[3] * 1.6, f[1]);
            ctx.arc(f[0], f[1], f[3] * 1.6, 0, Math.PI * 2);
        }
        ctx.fill();

        // Core
        ctx.fillStyle = color;
        ctx.beginPath();
        for (let i = 0; i < arr.length; i++) {
            const f = arr[i];
            ctx.moveTo(f[0] + f[3], f[1]);
            ctx.arc(f[0], f[1], f[3], 0, Math.PI * 2);
        }
        ctx.fill();

        // Highlight dot
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        for (let i = 0; i < arr.length; i++) {
            const f = arr[i];
            const r = f[3] * 0.3;
            ctx.moveTo(f[0] - f[3] * 0.2 + r, f[1] - f[3] * 0.2);
            ctx.arc(f[0] - f[3] * 0.2, f[1] - f[3] * 0.2, r, 0, Math.PI * 2);
        }
        ctx.fill();
    }
}

function drawSnakes() {
    // Sort: me last
    const arr = stateSnakes.slice().sort((a, b) => {
        if (a.isMe) return 1;
        if (b.isMe) return -1;
        return 0;
    });
    for (let i = 0; i < arr.length; i++) drawSnake(arr[i]);
}

function drawSnake(snake) {
    const segs = snake.segs; // flat [x,y,x,y,...]
    const segCount = segs.length / 2;
    if (segCount < 2) return;

    const br = Math.min(6 + snake.len * 0.08, 22);
    const hr = br * 1.15;
    const pal = palettes[snake.pal] || ['#fff','#ccc'];

    // Body outline/glow — single bigger pass with alpha
    ctx.fillStyle = pal[0] + '33'; // ~20% alpha
    ctx.beginPath();
    for (let i = segCount - 1; i >= 1; i--) {
        const x = segs[i * 2], y = segs[i * 2 + 1];
        const t = i / segCount;
        const r = br * (0.4 + t * 0.6) + 4;
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();

    // Body segments — two batch passes (alternating colors)
    for (let colorIdx = 0; colorIdx < 2; colorIdx++) {
        ctx.fillStyle = pal[colorIdx];
        ctx.beginPath();
        for (let i = segCount - 1; i >= 1; i--) {
            if ((Math.floor(i / 3) % 2) !== colorIdx) continue;
            const x = segs[i * 2], y = segs[i * 2 + 1];
            const t = i / segCount;
            const r = br * (0.4 + t * 0.6);
            ctx.moveTo(x + r, y);
            ctx.arc(x, y, r, 0, Math.PI * 2);
        }
        ctx.fill();
    }

    // Head
    const hx = segs[0], hy = segs[1];
    const nx = segs[2], ny = segs[3];
    const hAngle = Math.atan2(hy - ny, hx - nx);

    // Head glow
    ctx.fillStyle = pal[0] + '44';
    ctx.beginPath();
    ctx.arc(hx, hy, hr + 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = pal[0];
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    const eyeOff = hr * 0.45;
    const eyeR = hr * 0.35;
    const pupilR = hr * 0.18;
    const perp = hAngle + Math.PI / 2;

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    for (let side = -1; side <= 1; side += 2) {
        const ex = hx + Math.cos(hAngle) * hr * 0.3 + Math.cos(perp) * eyeOff * side;
        const ey = hy + Math.sin(hAngle) * hr * 0.3 + Math.sin(perp) * eyeOff * side;
        ctx.moveTo(ex + eyeR, ey);
        ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
    }
    ctx.fill();

    ctx.fillStyle = '#111';
    ctx.beginPath();
    for (let side = -1; side <= 1; side += 2) {
        const ex = hx + Math.cos(hAngle) * hr * 0.3 + Math.cos(perp) * eyeOff * side;
        const ey = hy + Math.sin(hAngle) * hr * 0.3 + Math.sin(perp) * eyeOff * side;
        const px = ex + Math.cos(hAngle) * pupilR * 0.4;
        const py = ey + Math.sin(hAngle) * pupilR * 0.4;
        ctx.moveTo(px + pupilR, py);
        ctx.arc(px, py, pupilR, 0, Math.PI * 2);
    }
    ctx.fill();

    // Name
    if (snake.isMe || snake.len > 25) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = `bold ${Math.max(12, hr * 1.1) | 0}px 'Segoe UI',Arial`;
        ctx.textAlign = 'center';
        ctx.fillText(snake.name, hx, hy - hr - 8);
    }
}

function drawCursor() {
    if (!playing) return;
    const mx = mouse.x, my = mouse.y;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mx, my, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mx - 18, my); ctx.lineTo(mx - 7, my);
    ctx.moveTo(mx + 7, my);  ctx.lineTo(mx + 18, my);
    ctx.moveTo(mx, my - 18); ctx.lineTo(mx, my - 7);
    ctx.moveTo(mx, my + 7);  ctx.lineTo(mx, my + 18);
    ctx.stroke();
}

function drawMinimap() {
    const mw = mmCanvas.width, mh = mmCanvas.height;
    mmCtx.clearRect(0, 0, mw, mh);
    mmCtx.fillStyle = 'rgba(0,0,0,0.6)';
    mmCtx.beginPath();
    mmCtx.roundRect(0, 0, mw, mh, 8);
    mmCtx.fill();
    mmCtx.strokeStyle = 'rgba(124,77,255,0.4)';
    mmCtx.lineWidth = 1;
    mmCtx.beginPath();
    mmCtx.roundRect(0, 0, mw, mh, 8);
    mmCtx.stroke();

    const scale = (mw - 10) / worldSize;
    const pad = 5;

    // Draw ALL snakes from global minimap data
    for (let i = 0; i < minimapData.length; i++) {
        const m = minimapData[i]; // [x, y, paletteIdx, isPlayer]
        const mx = m[0] * scale + pad;
        const my = m[1] * scale + pad;
        if (m[1] && m[3]) {
            // Real player — bigger dot
            mmCtx.fillStyle = '#7c4dff';
            mmCtx.beginPath();
            mmCtx.arc(mx, my, 3, 0, Math.PI * 2);
            mmCtx.fill();
        } else {
            // AI
            const p = palettes[m[2]] || ['#fff'];
            mmCtx.fillStyle = p[0];
            mmCtx.beginPath();
            mmCtx.arc(mx, my, 1.5, 0, Math.PI * 2);
            mmCtx.fill();
        }
    }
    // Highlight myself on top
    if (myId) {
        const me = stateSnakes.find(s => s.isMe);
        if (me && me.segs.length >= 2) {
            mmCtx.fillStyle = '#fff';
            mmCtx.beginPath();
            mmCtx.arc(me.segs[0] * scale + pad, me.segs[1] * scale + pad, 4, 0, Math.PI * 2);
            mmCtx.fill();
            mmCtx.fillStyle = '#7c4dff';
            mmCtx.beginPath();
            mmCtx.arc(me.segs[0] * scale + pad, me.segs[1] * scale + pad, 3, 0, Math.PI * 2);
            mmCtx.fill();
        }
    }

    const vw = canvas.width / camera.zoom * scale;
    const vh = canvas.height / camera.zoom * scale;
    mmCtx.strokeStyle = 'rgba(255,255,255,0.3)';
    mmCtx.lineWidth = 1;
    mmCtx.strokeRect(camera.x * scale + pad - vw / 2, camera.y * scale + pad - vh / 2, vw, vh);
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ============================================================
//  Start
// ============================================================
connect();
nameInput.focus();
if (highScore > 0) highScoreStartEl.textContent = `Best: ${highScore}`;
loop();
