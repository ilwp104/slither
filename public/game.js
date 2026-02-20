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
let frameTime = 0;
let mouse = { x: 0, y: 0 };
let isBoosting = false;
let connected = false;
let playing = false;
let playerName = 'Player';
let highScore = parseInt(localStorage.getItem('highScore')) || 0;
let lastScore = parseInt(localStorage.getItem('lastScore')) || 0;
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
            showJoystick(true);
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
                    kills: s[8] || 0, isMe: s[0] === msg.y,
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
            if (me) scoreEl.textContent = `Score: ${me.score}  |  Length: ${me.len}  |  Kills: ${me.kills}`;
            const pc = stateSnakes.filter(s => s.id.startsWith('p_')).length;
            onlineCountEl.textContent = `${pc} player(s) online`;
        }
        if (msg.t === 'd') {
            playing = false;
            finalScoreEl.textContent = `Score: ${msg.sc}  |  Length: ${msg.l}  |  Kills: ${msg.k || 0}`;
            lastScore = msg.sc; localStorage.setItem('lastScore', lastScore);
            if (msg.sc > highScore) {
                highScore = msg.sc;
                localStorage.setItem('highScore', highScore);
            }
            highScoreOverEl.textContent = `Best: ${highScore}`;
            showJoystick(false);
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

// Touch controls
const isTouchDevice = 'ontouchstart' in window;
let touchMode = localStorage.getItem('touchMode') || 'touch'; // 'touch' or 'joystick'
const joystickEl = document.getElementById('joystickArea');
const boostBtnEl = document.getElementById('boostBtn');
const jCtx = joystickEl.getContext('2d');
let joyActive = false, joyTouchId = null, joyCx = 70, joyCy = 70, joyX = 70, joyY = 70;

// Touch mode selector
document.querySelectorAll('.tm-btn').forEach(btn => {
    if (btn.dataset.mode === touchMode) btn.classList.add('active');
    else btn.classList.remove('active');
    btn.addEventListener('click', () => {
        touchMode = btn.dataset.mode;
        localStorage.setItem('touchMode', touchMode);
        document.querySelectorAll('.tm-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    });
});

function showJoystick(show) {
    if (!isTouchDevice) return;
    joystickEl.style.display = show && touchMode === 'joystick' ? 'block' : 'none';
    boostBtnEl.style.display = show ? 'block' : 'none';
}

function drawJoystick() {
    if (!isTouchDevice || touchMode !== 'joystick' || !playing) return;
    const w = 140, h = 140;
    jCtx.clearRect(0, 0, w, h);
    // Base
    jCtx.beginPath(); jCtx.arc(joyCx, joyCy, 60, 0, Math.PI * 2);
    jCtx.fillStyle = 'rgba(255,255,255,0.08)'; jCtx.fill();
    jCtx.strokeStyle = 'rgba(255,255,255,0.2)'; jCtx.lineWidth = 2; jCtx.stroke();
    // Stick
    jCtx.beginPath(); jCtx.arc(joyX, joyY, 24, 0, Math.PI * 2);
    jCtx.fillStyle = 'rgba(124,77,255,0.5)'; jCtx.fill();
    jCtx.strokeStyle = 'rgba(124,77,255,0.8)'; jCtx.lineWidth = 2; jCtx.stroke();
}

// Joystick touch
joystickEl.addEventListener('touchstart', (e) => {
    e.preventDefault(); e.stopPropagation();
    const t = e.changedTouches[0];
    joyTouchId = t.identifier; joyActive = true;
    const r = joystickEl.getBoundingClientRect();
    joyX = t.clientX - r.left; joyY = t.clientY - r.top;
    updateJoyAngle();
}, { passive: false });
joystickEl.addEventListener('touchmove', (e) => {
    e.preventDefault(); e.stopPropagation();
    for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === joyTouchId) {
            const r = joystickEl.getBoundingClientRect();
            let dx = t.clientX - r.left - joyCx, dy = t.clientY - r.top - joyCy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 55) { dx = dx / dist * 55; dy = dy / dist * 55; }
            joyX = joyCx + dx; joyY = joyCy + dy;
            updateJoyAngle();
        }
    }
}, { passive: false });
joystickEl.addEventListener('touchend', (e) => {
    e.preventDefault(); e.stopPropagation();
    for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === joyTouchId) {
            joyActive = false; joyX = joyCx; joyY = joyCy;
        }
    }
}, { passive: false });

function updateJoyAngle() {
    const dx = joyX - joyCx, dy = joyY - joyCy;
    if (dx * dx + dy * dy > 100) { // deadzone 10px
        mouse.x = canvas.width / 2 + dx * 10;
        mouse.y = canvas.height / 2 + dy * 10;
    }
}

// Boost button
boostBtnEl.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); isBoosting = true; }, { passive: false });
boostBtnEl.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); isBoosting = false; }, { passive: false });

// Direct touch mode
let touchId = null;
canvas.addEventListener('touchstart', (e) => {
    if (touchMode === 'joystick') { e.preventDefault(); return; }
    e.preventDefault();
    const t = e.changedTouches[0];
    touchId = t.identifier;
    mouse.x = t.clientX; mouse.y = t.clientY;
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
    if (touchMode === 'joystick') { e.preventDefault(); return; }
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === touchId) { mouse.x = t.clientX; mouse.y = t.clientY; }
    }
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
}, { passive: false });

setInterval(() => {
    if (!ws || ws.readyState !== 1 || !playing) return;
    const a = Math.atan2(mouse.y - canvas.height / 2, mouse.x - canvas.width / 2);
    ws.send(JSON.stringify({ type: 'input', a, b: isBoosting }));
}, 50);

playBtn.addEventListener('click', joinGame);
retryBtn.addEventListener('click', respawnGame);
homeBtn.addEventListener('click', goHome);
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinGame(); });
function goFullscreen() {
    const el = document.documentElement;
    const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (rfs && !document.fullscreenElement && !document.webkitFullscreenElement) {
        rfs.call(el).catch(() => {});
    }
}
function joinGame() {
    playerName = nameInput.value.trim() || 'Player';
    if (isTouchDevice) goFullscreen();
    if (!connected) { connect(); setTimeout(joinGame, 500); return; }
    ws.send(JSON.stringify({ type: 'join', name: playerName }));
}
function respawnGame() {
    gameOverEl.style.display = 'none';
    showJoystick(true);
    if (isTouchDevice) goFullscreen();
    if (!connected) { connect(); setTimeout(respawnGame, 500); return; }
    ws.send(JSON.stringify({ type: 'respawn', name: playerName }));
}
function goHome() {
    playing = false;
    hudEl.style.display = 'none';
    gameOverEl.style.display = 'none';
    startScreen.style.display = 'flex';
    document.body.style.cursor = 'default';
    showJoystick(false);
    highScoreStartEl.textContent = highScore > 0 ? `Best: ${highScore}` : '';
    document.getElementById('lastScoreStart').textContent = lastScore > 0 ? `Last: ${lastScore}` : '';
    if (ws && ws.readyState === 1) ws.close();
}

// ============================================================
//  Render Loop
// ============================================================
function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function loop(ts) {
    frameTime = ts || 0;
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
    drawTopIndicator();
    drawCursor();
    drawJoystick();
    drawMinimap();
}

function drawTopIndicator() {
    if (!playing) return;
    const me = stateSnakes.find(s => s.isMe);
    if (!me || me.segs.length < 2) return;
    const top = stateSnakes.find(s => s.id === topSnakeId);
    if (!top || top.isMe || top.score <= 0) return;

    const mx = me.segs[0], my = me.segs[1];
    const z = camera.zoom;
    const w = canvas.width, h = canvas.height;

    // Top snake screen position
    const sx = (top.segs[0] - camera.x) * z + w / 2;
    const sy = (top.segs[1] - camera.y) * z + h / 2;
    const onScreen = sx > 0 && sx < w && sy > 0 && sy < h;
    if (onScreen) return;

    // Distance & direction
    const dx = top.segs[0] - mx, dy = top.segs[1] - my;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ang = Math.atan2(dy, dx);
    const close = dist < 500;

    const margin = 40;
    let ix = w / 2 + Math.cos(ang) * (w / 2 - margin);
    let iy = h / 2 + Math.sin(ang) * (h / 2 - margin);
    ix = Math.max(margin, Math.min(w - margin, ix));
    iy = Math.max(margin, Math.min(h - margin, iy));

    // Arrow color: gold normally, red+blink when close
    const pulse = 0.5 + 0.5 * Math.sin(frameTime * (close ? 0.015 : 0.005));
    const color = close ? `rgba(255,50,50,${(0.5 + pulse * 0.5).toFixed(2)})` : '#ffd700';
    const sz = close ? 16 : 12;

    ctx.save();
    ctx.translate(ix, iy);
    ctx.rotate(ang);
    ctx.fillStyle = color;
    ctx.globalAlpha = close ? 0.5 + pulse * 0.5 : 0.7 + 0.3 * pulse;
    ctx.beginPath();
    ctx.moveTo(sz, 0);
    ctx.lineTo(-sz * 0.7, -sz * 0.7);
    ctx.lineTo(-sz * 0.2, 0);
    ctx.lineTo(-sz * 0.7, sz * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();

    // Label
    ctx.fillStyle = color;
    ctx.font = `bold ${close ? 13 : 11}px "Segoe UI",Arial`;
    ctx.textAlign = 'center';
    const lbl = close ? `#1 ${top.name}` : '#1';
    ctx.fillText(lbl, ix - Math.cos(ang) * 20, iy - Math.sin(ang) * 20 + 4);
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
    const t = frameTime * 0.001; // seconds
    for (let i = 0; i < stateFoods.length; i++) {
        const f = stateFoods[i];
        const c = f[2];
        if (!byColor[c]) byColor[c] = [];
        // Compute per-food wiggle offset using position as seed
        const phase = f[0] * 0.7 + f[1] * 1.3;
        const wx = Math.sin(t * 1.5 + phase) * 1.8;
        const wy = Math.cos(t * 1.8 + phase * 0.7) * 1.8;
        byColor[c].push([f[0] + wx, f[1] + wy, f[2], f[3]]);
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

let topSnakeId = null;
function drawSnakes() {
    // Find #1
    let topScore = -1;
    for (let i = 0; i < stateSnakes.length; i++) {
        if (stateSnakes[i].score > topScore) { topScore = stateSnakes[i].score; topSnakeId = stateSnakes[i].id; }
    }
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

    // Crown for #1
    if (snake.id === topSnakeId && snake.score > 0) {
        ctx.save();
        ctx.translate(hx, hy);
        ctx.rotate(hAngle - Math.PI / 2);
        const cs = hr * 0.9;
        ctx.translate(0, -hr - cs * 0.3);
        ctx.fillStyle = '#ffd700';
        ctx.beginPath();
        ctx.moveTo(-cs, cs * 0.5);
        ctx.lineTo(-cs, -cs * 0.1);
        ctx.lineTo(-cs * 0.5, cs * 0.25);
        ctx.lineTo(0, -cs * 0.5);
        ctx.lineTo(cs * 0.5, cs * 0.25);
        ctx.lineTo(cs, -cs * 0.1);
        ctx.lineTo(cs, cs * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#b8960c';
        ctx.lineWidth = 1;
        ctx.stroke();
        // Gems
        ctx.fillStyle = '#ff4444';
        ctx.beginPath(); ctx.arc(0, 0, cs * 0.13, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#44aaff';
        ctx.beginPath(); ctx.arc(-cs * 0.5, cs * 0.15, cs * 0.1, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cs * 0.5, cs * 0.15, cs * 0.1, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }
}

function drawCursor() {
    if (!playing) return;
    if (isTouchDevice && touchMode === 'joystick') {
        // Arrow indicator near snake head
        const me = stateSnakes.find(s => s.isMe);
        if (!me || me.segs.length < 2) return;
        const a = Math.atan2(mouse.y - canvas.height / 2, mouse.x - canvas.width / 2);
        const cx2 = canvas.width / 2, cy2 = canvas.height / 2;
        const dist = 50;
        const ax = cx2 + Math.cos(a) * dist, ay = cy2 + Math.sin(a) * dist;
        const sz = 14;
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(a);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.beginPath();
        ctx.moveTo(sz, 0);
        ctx.lineTo(-sz * 0.6, -sz * 0.6);
        ctx.lineTo(-sz * 0.25, 0);
        ctx.lineTo(-sz * 0.6, sz * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        return;
    }
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
if (lastScore > 0) document.getElementById('lastScoreStart').textContent = `Last: ${lastScore}`;
loop();
