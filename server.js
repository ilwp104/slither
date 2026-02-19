// ============================================================
//  Slither.io Clone — Multiplayer Server (Optimized)
// ============================================================
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// --- Constants ---
const PORT = process.env.PORT || 3000;
const WORLD_SIZE = 6000;
const TICK_RATE = 30;
const SEND_RATE = 15;
const FOOD_COUNT = 800;
const AI_COUNT = 15;
const INITIAL_LENGTH = 20;
const SEG_GAP = 4;
const BASE_SPEED = 3.2;
const BOOST_SPEED = 6;
const FOOD_RADIUS = 5;
const MIN_BODY_R = 6;
const TURN_RATE = 0.12;
const VIEW_RANGE = 1800;
const GRID_CELL = 200; // spatial grid cell size

const PALETTES = [
    ['#ff6b6b','#ee5a24'],['#48dbfb','#0abde3'],['#feca57','#ff9f43'],
    ['#55efc4','#00b894'],['#a29bfe','#6c5ce7'],['#fd79a8','#e84393'],
    ['#fdcb6e','#f39c12'],['#00cec9','#00b894'],['#e17055','#d63031'],
    ['#74b9ff','#0984e3'],['#dfe6e9','#b2bec3'],['#fab1a0','#e17055'],
];
const FOOD_COLORS = [
    '#ff6b6b','#48dbfb','#feca57','#55efc4','#a29bfe',
    '#fd79a8','#fdcb6e','#00cec9','#ff9ff3','#f368e0',
];
const AI_NAMES = [
    'Viper','Cobra','Python','Mamba','Naga','Serpent','Basilisk',
    'Hydra','Rattler','Boa','Adder','Asp','Draco','Slyther',
    'Fang','Scales','Striker','Shadow','Venom','Blaze',
];

// --- Spatial Grid for collision ---
const GRID_COLS = Math.ceil(WORLD_SIZE / GRID_CELL);
let spatialGrid = null;

function resetGrid() {
    spatialGrid = new Array(GRID_COLS * GRID_COLS);
    for (let i = 0; i < spatialGrid.length; i++) spatialGrid[i] = [];
}

function gridKey(x, y) {
    const col = Math.min(GRID_COLS - 1, Math.max(0, (x / GRID_CELL) | 0));
    const row = Math.min(GRID_COLS - 1, Math.max(0, (y / GRID_CELL) | 0));
    return row * GRID_COLS + col;
}

function insertSegToGrid(snakeId, segIdx, x, y) {
    const k = gridKey(x, y);
    spatialGrid[k].push({ sid: snakeId, idx: segIdx, x, y });
}

// --- Game State ---
let nextId = 1;
const snakes = new Map();
const clients = new Map();
let foods = [];
let foodIdCounter = 1;
// Food delta tracking per client
let foodAddBuffer = [];
let foodRemoveBuffer = [];

// ============================================================
//  Snake
// ============================================================
class Snake {
    constructor(id, name, isAI = false) {
        this.id = id;
        this.name = name;
        this.isAI = isAI;
        this.alive = true;
        this.angle = Math.random() * Math.PI * 2;
        this.targetAngle = this.angle;
        this.speed = BASE_SPEED;
        this.boosting = false;
        this.paletteIdx = Math.floor(Math.random() * PALETTES.length);

        const cx = WORLD_SIZE / 2 + (Math.random() - 0.5) * 2000;
        const cy = WORLD_SIZE / 2 + (Math.random() - 0.5) * 2000;
        this.segments = [];
        for (let i = 0; i < INITIAL_LENGTH; i++) {
            this.segments.push({
                x: cx - i * SEG_GAP * Math.cos(this.angle),
                y: cy - i * SEG_GAP * Math.sin(this.angle),
            });
        }
        this.aiTimer = 0;
        this.aiWanderAngle = this.angle;
    }

    get x() { return this.segments[0].x; }
    get y() { return this.segments[0].y; }
    get length() { return this.segments.length; }
    get score() { return Math.max(0, this.segments.length - INITIAL_LENGTH); }
    get bodyRadius() { return Math.min(MIN_BODY_R + this.length * 0.08, 22); }
    get headRadius() { return this.bodyRadius * 1.15; }

    update() {
        if (!this.alive) return;
        let diff = this.targetAngle - this.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.angle += diff * TURN_RATE;

        this.speed = (this.boosting && this.length > 20) ? BOOST_SPEED : BASE_SPEED;
        const head = {
            x: this.segments[0].x + Math.cos(this.angle) * this.speed,
            y: this.segments[0].y + Math.sin(this.angle) * this.speed,
        };
        const m = 150;
        if (head.x < m) head.x += (m - head.x) * 0.1;
        if (head.y < m) head.y += (m - head.y) * 0.1;
        if (head.x > WORLD_SIZE - m) head.x -= (head.x - (WORLD_SIZE - m)) * 0.1;
        if (head.y > WORLD_SIZE - m) head.y -= (head.y - (WORLD_SIZE - m)) * 0.1;
        head.x = Math.max(10, Math.min(WORLD_SIZE - 10, head.x));
        head.y = Math.max(10, Math.min(WORLD_SIZE - 10, head.y));

        this.segments.unshift(head);
        if (this.boosting && this.length > 20) {
            const t = this.segments.pop();
            this.segments.pop();
            if (Math.random() < 0.3) addFood(t.x, t.y, false);
        } else {
            this.segments.pop();
        }
    }

    grow(n) {
        for (let i = 0; i < n; i++) {
            const tail = this.segments[this.segments.length - 1];
            this.segments.push({ x: tail.x, y: tail.y });
        }
    }

    die() {
        if (!this.alive) return;
        this.alive = false;
        for (let i = 0; i < this.segments.length; i += 3) {
            const s = this.segments[i];
            addFood(s.x + (Math.random() - 0.5) * 10, s.y + (Math.random() - 0.5) * 10, true);
        }
    }

    updateAI() {
        if (!this.alive || !this.isAI) return;
        this.aiTimer--;
        const bm = 400, cx = WORLD_SIZE / 2, cy = WORLD_SIZE / 2;
        if (this.x < bm || this.x > WORLD_SIZE - bm || this.y < bm || this.y > WORLD_SIZE - bm) {
            this.targetAngle = Math.atan2(cy - this.y, cx - this.x);
            this.aiTimer = 60;
            this.boosting = false;
            return;
        }
        // Danger check
        let danger = false;
        for (const [, other] of snakes) {
            if (other === this || !other.alive) continue;
            const dx = this.x - other.x, dy = this.y - other.y;
            if (dx * dx + dy * dy < 14400 && other.length > this.length * 0.8) {
                this.targetAngle = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.5;
                this.boosting = this.length > 25;
                this.aiTimer = 30;
                danger = true;
                break;
            }
        }
        if (danger) return;

        if (this.aiTimer <= 0) {
            this.boosting = false;
            // Find food — skip very close ones to avoid circling
            let best = null, bestD2 = 90000;
            const minD2 = 400; // ignore food closer than 20px (already eating it)
            for (const f of foods) {
                const dx = this.x - f.x, dy = this.y - f.y;
                const d2 = dx * dx + dy * dy;
                if (d2 > minD2 && d2 < bestD2) { bestD2 = d2; best = f; }
            }
            if (best) {
                // Aim slightly ahead with random offset to avoid orbiting
                this.targetAngle = Math.atan2(best.y - this.y, best.x - this.x) + (Math.random() - 0.5) * 0.3;
                this.aiTimer = 15 + Math.random() * 10;
            } else {
                this.aiWanderAngle += (Math.random() - 0.5) * 2.0;
                this.targetAngle = this.aiWanderAngle;
                this.aiTimer = 40 + Math.random() * 60;
            }
        }
    }
}

// ============================================================
//  Food helpers
// ============================================================
function addFood(x, y, big) {
    const f = {
        id: foodIdCounter++,
        x: x !== undefined ? x : Math.random() * (WORLD_SIZE - 200) + 100,
        y: y !== undefined ? y : Math.random() * (WORLD_SIZE - 200) + 100,
        c: FOOD_COLORS[(Math.random() * FOOD_COLORS.length) | 0],
        r: big ? FOOD_RADIUS * 1.8 : FOOD_RADIUS,
        v: big ? 3 : 1,
    };
    foods.push(f);
    foodAddBuffer.push(f);
    return f;
}

function removeFood(idx) {
    foodRemoveBuffer.push(foods[idx].id);
    foods.splice(idx, 1);
}

function getNearbyCells(x, y, range) {
    const keys = [];
    const c1 = Math.max(0, ((x - range) / GRID_CELL) | 0);
    const c2 = Math.min(GRID_COLS - 1, ((x + range) / GRID_CELL) | 0);
    const r1 = Math.max(0, ((y - range) / GRID_CELL) | 0);
    const r2 = Math.min(GRID_COLS - 1, ((y + range) / GRID_CELL) | 0);
    for (let r = r1; r <= r2; r++)
        for (let c = c1; c <= c2; c++)
            keys.push(r * GRID_COLS + c);
    return keys;
}

// ============================================================
//  Init
// ============================================================
function initWorld() {
    foods = [];
    for (let i = 0; i < FOOD_COUNT; i++) addFood();
    foodAddBuffer = []; // don't send initial food as delta
    for (let i = 0; i < AI_COUNT; i++) spawnAI();
}

function spawnAI(nearPlayer) {
    const id = 'ai_' + nextId++;
    const name = AI_NAMES[(Math.random() * AI_NAMES.length) | 0];
    const s = new Snake(id, name, true);

    // 50% chance to spawn near a random player so there's always activity nearby
    if (nearPlayer || Math.random() < 0.5) {
        const players = [...snakes.values()].filter(p => !p.isAI && p.alive);
        if (players.length > 0) {
            const p = players[Math.floor(Math.random() * players.length)];
            const angle = Math.random() * Math.PI * 2;
            const dist = 800 + Math.random() * 1200; // 800~2000px away
            const nx = Math.max(200, Math.min(WORLD_SIZE - 200, p.x + Math.cos(angle) * dist));
            const ny = Math.max(200, Math.min(WORLD_SIZE - 200, p.y + Math.sin(angle) * dist));
            // Reposition all segments
            for (let i = 0; i < s.segments.length; i++) {
                s.segments[i].x = nx - i * SEG_GAP * Math.cos(s.angle);
                s.segments[i].y = ny - i * SEG_GAP * Math.sin(s.angle);
            }
        }
    }

    s.grow(Math.floor(Math.random() * 60));
    snakes.set(id, s);
}

// ============================================================
//  Game Loop
// ============================================================
let tickCount = 0;

function tick() {
    tickCount++;
    foodAddBuffer = [];
    foodRemoveBuffer = [];

    // AI
    for (const [, s] of snakes) s.updateAI();
    // Move
    for (const [, s] of snakes) s.update();

    // Build spatial grid for body segments
    resetGrid();
    for (const [, s] of snakes) {
        if (!s.alive) continue;
        // Insert every 2nd segment starting from index 8 (skip head area)
        for (let i = 8; i < s.segments.length; i += 2) {
            insertSegToGrid(s.id, i, s.segments[i].x, s.segments[i].y);
        }
    }

    // Food collision
    for (const [, snake] of snakes) {
        if (!snake.alive) continue;
        const hr = snake.headRadius;
        const hr2 = (hr + FOOD_RADIUS * 2) * (hr + FOOD_RADIUS * 2);
        for (let i = foods.length - 1; i >= 0; i--) {
            const f = foods[i];
            const dx = snake.x - f.x, dy = snake.y - f.y;
            if (dx * dx + dy * dy < hr2) {
                snake.grow(f.v);
                removeFood(i);
            }
        }
    }

    // Snake-snake collision via spatial grid
    const allSnakes = [...snakes.values()];
    for (const snake of allSnakes) {
        if (!snake.alive) continue;
        const hr = snake.headRadius + 15; // approximate combined radius
        const hr2 = hr * hr;
        const cells = getNearbyCells(snake.x, snake.y, hr);
        for (const ck of cells) {
            const cell = spatialGrid[ck];
            for (let j = 0; j < cell.length; j++) {
                const entry = cell[j];
                if (entry.sid === snake.id) continue;
                const dx = snake.x - entry.x, dy = snake.y - entry.y;
                if (dx * dx + dy * dy < hr2) {
                    snake.die();
                    notifyDeath(snake);
                    break;
                }
            }
            if (!snake.alive) break;
        }
    }

    // Cleanup dead snakes (collect first, then delete)
    const deadIds = [];
    for (const [id, s] of snakes) {
        if (!s.alive && s.isAI) deadIds.push(id);
    }
    for (const id of deadIds) snakes.delete(id);

    // Also clean dead player snakes that disconnected
    for (const [id, s] of snakes) {
        if (!s.alive && !s.isAI && !clients.has(id)) snakes.delete(id);
    }

    // Respawn AI — always maintain AI_COUNT alive AIs
    let aiAlive = 0;
    for (const [, s] of snakes) if (s.isAI && s.alive) aiAlive++;
    while (aiAlive < AI_COUNT) { spawnAI(true); aiAlive++; }

    // Replenish food
    while (foods.length < FOOD_COUNT) addFood();

    // Broadcast
    if (tickCount % Math.max(1, Math.round(TICK_RATE / SEND_RATE)) === 0) {
        broadcastState();
    }
}

function notifyDeath(snake) {
    for (const [, client] of clients) {
        if (client.snakeId === snake.id) {
            safeSend(client.ws, JSON.stringify({
                t: 'd', sc: snake.score, l: snake.length,
            }));
        }
    }
}

// Pre-allocate reusable buffer for state messages
function broadcastState() {
    for (const [, client] of clients) {
        const snake = snakes.get(client.snakeId);
        if (!snake) continue;

        const px = snake.alive ? snake.x : WORLD_SIZE / 2;
        const py = snake.alive ? snake.y : WORLD_SIZE / 2;

        // Nearby snakes — compact format
        const ns = [];
        for (const [, s] of snakes) {
            if (!s.alive) continue;
            const dx = s.x - px, dy = s.y - py;
            if (dx > VIEW_RANGE || dx < -VIEW_RANGE || dy > VIEW_RANGE || dy < -VIEW_RANGE) continue;

            // Subsample segments
            const segs = [];
            const step = Math.max(1, (s.segments.length / 60) | 0);
            for (let i = 0; i < s.segments.length; i += step) {
                segs.push((s.segments[i].x + 0.5) | 0);
                segs.push((s.segments[i].y + 0.5) | 0);
            }
            // Always include tail
            const last = s.segments[s.segments.length - 1];
            segs.push((last.x + 0.5) | 0);
            segs.push((last.y + 0.5) | 0);

            ns.push([
                s.id, s.name, segs, s.paletteIdx, s.length,
                ((s.angle * 100 + 0.5) | 0) / 100, s.boosting ? 1 : 0, s.score
            ]);
        }

        // Nearby food
        const nf = [];
        for (let i = 0; i < foods.length; i++) {
            const f = foods[i];
            const dx = f.x - px, dy = f.y - py;
            if (dx > VIEW_RANGE || dx < -VIEW_RANGE || dy > VIEW_RANGE || dy < -VIEW_RANGE) continue;
            nf.push([(f.x + 0.5) | 0, (f.y + 0.5) | 0, f.c, f.r]);
        }

        safeSend(client.ws, JSON.stringify({
            t: 's',
            s: ns,
            f: nf,
            y: client.snakeId,
        }));
    }
}

// ============================================================
//  WebSocket
// ============================================================
wss.on('connection', (ws) => {
    let clientId = null;

    ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }

        if (msg.type === 'join') {
            const id = 'p_' + nextId++;
            const name = (msg.name || 'Player').substring(0, 15);
            const snake = new Snake(id, name, false);
            snakes.set(id, snake);
            clientId = id;
            clients.set(id, { ws, snakeId: id });
            safeSend(ws, JSON.stringify({
                t: 'w', id, ws: WORLD_SIZE, p: PALETTES,
            }));
            console.log(`[+] ${name} joined (${clients.size} online)`);
        }

        if (msg.type === 'input' && clientId) {
            const snake = snakes.get(clientId);
            if (snake && snake.alive) {
                if (typeof msg.a === 'number' && isFinite(msg.a)) snake.targetAngle = msg.a;
                snake.boosting = !!msg.b;
            }
        }

        if (msg.type === 'respawn' && clientId) {
            const old = snakes.get(clientId);
            if (old) snakes.delete(clientId);
            const newId = 'p_' + nextId++;
            const name = (msg.name || 'Player').substring(0, 15);
            const snake = new Snake(newId, name, false);
            snakes.set(newId, snake);
            clientId = newId;
            clients.set(clientId, { ws, snakeId: newId });
            safeSend(ws, JSON.stringify({
                t: 'w', id: newId, ws: WORLD_SIZE, p: PALETTES,
            }));
        }
    });

    ws.on('close', () => {
        if (clientId) {
            const snake = snakes.get(clientId);
            if (snake) { snake.die(); snakes.delete(clientId); }
            clients.delete(clientId);
            console.log(`[-] Left (${clients.size} online)`);
        }
    });
});

function safeSend(ws, data) {
    if (ws.readyState === 1) ws.send(data);
}

// ============================================================
//  Start
// ============================================================
initWorld();
setInterval(tick, 1000 / TICK_RATE);
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Slither.io running on http://0.0.0.0:${PORT}`);
});
