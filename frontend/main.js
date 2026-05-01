// ============================================
// SkyNet Sentinel — Main Application
// Canvas rendering + WebSocket client + UI logic
// ============================================

// --- Configuration ---
const WS_URL = `ws://${window.location.hostname}:8765`;
const TRAIL_LENGTH = 25;
const CANVAS_W = 800;
const CANVAS_H = 600;

// --- Colors ---
const COLORS = {
    grid: 'rgba(0, 229, 255, 0.06)',
    gridBright: 'rgba(0, 229, 255, 0.12)',
    rangeRing: 'rgba(0, 229, 255, 0.08)',
    rangeLabel: 'rgba(0, 229, 255, 0.25)',
    sweep: 'rgba(0, 229, 255, 0.04)',
    trackConfirmed: '#00e5ff',
    trackTentative: '#3d4f6a',
    trail: 'rgba(0, 229, 255, 0.15)',
    prediction: 'rgba(179, 136, 255, 0.5)',
    swarmHull: 'rgba(57, 255, 20, 0.3)',
    swarmHullBorder: '#39ff14',
    swarmCenter: '#39ff14',
    label: 'rgba(224, 230, 237, 0.7)',
};

// --- State ---
const appState = {
    tracks: [],
    swarms: [],
    predictions: {},
    stats: {},
    trails: {},       // track_id -> [{x, y}, ...] (last N positions)
    connected: false,
    paused: false,
    sweepAngle: 0,
};

// --- DOM Elements ---
const canvas = document.getElementById('radar');
const ctx = canvas.getContext('2d');
const statusBadge = document.getElementById('connection-status');
const clockEl = document.getElementById('clock');
const toggleBtn = document.getElementById('toggle-btn');
const toggleIcon = document.getElementById('toggle-icon');
const toggleText = document.getElementById('toggle-text');
const scenarioSelect = document.getElementById('scenario-select');

// --- WebSocket ---
let ws = null;
let reconnectTimer = null;

function connectWebSocket() {
    if (ws && ws.readyState <= 1) return;

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        appState.connected = true;
        statusBadge.textContent = 'CONNECTED';
        statusBadge.className = 'status-badge connected';
        console.log('[WS] Connected');
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleData(data);
        } catch (e) {
            console.error('[WS] Parse error:', e);
        }
    };

    ws.onclose = () => {
        appState.connected = false;
        statusBadge.textContent = 'DISCONNECTED';
        statusBadge.className = 'status-badge disconnected';
        console.log('[WS] Disconnected, retrying in 2s...');
        reconnectTimer = setTimeout(connectWebSocket, 2000);
    };

    ws.onerror = () => {
        ws.close();
    };
}

function sendCommand(cmd) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(cmd));
    }
}

// --- Data Handler ---
function handleData(data) {
    appState.tracks = data.tracks || [];
    appState.swarms = data.swarms || [];
    appState.predictions = data.predictions || {};
    appState.stats = data.stats || {};

    // Update trails
    for (const track of appState.tracks) {
        if (!appState.trails[track.track_id]) {
            appState.trails[track.track_id] = [];
        }
        const trail = appState.trails[track.track_id];
        trail.push({ x: track.x, y: track.y });
        if (trail.length > TRAIL_LENGTH) {
            trail.shift();
        }
    }

    // Clean up trails for tracks that no longer exist
    const activeIds = new Set(appState.tracks.map(t => t.track_id));
    for (const id of Object.keys(appState.trails)) {
        if (!activeIds.has(parseInt(id))) {
            delete appState.trails[id];
        }
    }

    updateStatsPanel();
    updateSwarmPanel();
}

// --- Canvas Rendering ---
function drawGrid() {
    const cx = CANVAS_W / 2;
    const cy = CANVAS_H / 2;

    // Background
    ctx.fillStyle = '#0a1020';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Fine grid
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= CANVAS_W; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_H);
        ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_H; y += 50) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_W, y);
        ctx.stroke();
    }

    // Major grid lines
    ctx.strokeStyle = COLORS.gridBright;
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= CANVAS_W; x += 100) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_H);
        ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_H; y += 100) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_W, y);
        ctx.stroke();
    }

    // Range rings from center
    ctx.strokeStyle = COLORS.rangeRing;
    ctx.lineWidth = 1;
    for (let r = 100; r <= 400; r += 100) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
    }

    // Range labels
    ctx.fillStyle = COLORS.rangeLabel;
    ctx.font = '10px "JetBrains Mono"';
    ctx.textAlign = 'center';
    for (let r = 100; r <= 400; r += 100) {
        ctx.fillText(`${r}m`, cx + r + 2, cy - 4);
    }

    // Crosshairs
    ctx.strokeStyle = COLORS.gridBright;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, CANVAS_H);
    ctx.moveTo(0, cy);
    ctx.lineTo(CANVAS_W, cy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Sweep line
    appState.sweepAngle += 0.015;
    const sweepLen = 400;
    const sx = cx + Math.cos(appState.sweepAngle) * sweepLen;
    const sy = cy + Math.sin(appState.sweepAngle) * sweepLen;

    const gradient = ctx.createLinearGradient(cx, cy, sx, sy);
    gradient.addColorStop(0, 'rgba(0, 229, 255, 0.12)');
    gradient.addColorStop(1, 'rgba(0, 229, 255, 0)');

    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(sx, sy);
    ctx.stroke();

    // Sweep cone (trailing glow)
    ctx.fillStyle = COLORS.sweep;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, sweepLen, appState.sweepAngle - 0.3, appState.sweepAngle);
    ctx.closePath();
    ctx.fill();
}

function drawTrails() {
    for (const [id, trail] of Object.entries(appState.trails)) {
        if (trail.length < 2) continue;

        const track = appState.tracks.find(t => t.track_id === parseInt(id));
        const isConfirmed = track && track.confirmed;

        for (let i = 1; i < trail.length; i++) {
            const alpha = (i / trail.length) * (isConfirmed ? 0.4 : 0.15);
            ctx.strokeStyle = isConfirmed
                ? `rgba(0, 229, 255, ${alpha})`
                : `rgba(61, 79, 106, ${alpha})`;
            ctx.lineWidth = isConfirmed ? 1.5 : 1;
            ctx.beginPath();
            ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
            ctx.lineTo(trail[i].x, trail[i].y);
            ctx.stroke();
        }
    }
}

function drawTracks() {
    for (const track of appState.tracks) {
        const { x, y, track_id, confirmed } = track;

        if (confirmed) {
            // Outer glow
            ctx.beginPath();
            ctx.arc(x, y, 8, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0, 229, 255, 0.15)';
            ctx.fill();

            // Inner dot
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = COLORS.trackConfirmed;
            ctx.fill();

            // Label
            ctx.fillStyle = COLORS.label;
            ctx.font = '9px "JetBrains Mono"';
            ctx.textAlign = 'left';
            ctx.fillText(`T${track_id}`, x + 10, y - 4);
        } else {
            // Tentative: dim gray dot
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fillStyle = COLORS.trackTentative;
            ctx.fill();
        }
    }
}

function drawPredictions() {
    for (const [trackId, preds] of Object.entries(appState.predictions)) {
        if (!preds || preds.length === 0) continue;

        const track = appState.tracks.find(t => t.track_id === parseInt(trackId));
        if (!track) continue;

        // Draw prediction dots
        let prevX = track.x;
        let prevY = track.y;

        for (let i = 0; i < preds.length; i++) {
            const alpha = 0.5 - (i * 0.08);
            const radius = 2.5 - (i * 0.3);

            // Connecting line
            ctx.strokeStyle = `rgba(179, 136, 255, ${alpha * 0.5})`;
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(prevX, prevY);
            ctx.lineTo(preds[i].x, preds[i].y);
            ctx.stroke();
            ctx.setLineDash([]);

            // Dot
            ctx.beginPath();
            ctx.arc(preds[i].x, preds[i].y, Math.max(radius, 1), 0, Math.PI * 2);
            ctx.fillStyle = `rgba(179, 136, 255, ${alpha})`;
            ctx.fill();

            prevX = preds[i].x;
            prevY = preds[i].y;
        }
    }
}

function convexHull(points) {
    // Graham scan for convex hull
    if (points.length < 3) return points.slice();

    // Find lowest y point (leftmost if tie)
    let lowest = 0;
    for (let i = 1; i < points.length; i++) {
        if (points[i][1] > points[lowest][1] ||
            (points[i][1] === points[lowest][1] && points[i][0] < points[lowest][0])) {
            lowest = i;
        }
    }

    const pivot = points[lowest];
    const sorted = points
        .filter((_, i) => i !== lowest)
        .sort((a, b) => {
            const angleA = Math.atan2(a[1] - pivot[1], a[0] - pivot[0]);
            const angleB = Math.atan2(b[1] - pivot[1], b[0] - pivot[0]);
            return angleA - angleB;
        });

    const hull = [pivot, sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
        while (hull.length > 1) {
            const a = hull[hull.length - 2];
            const b = hull[hull.length - 1];
            const c = sorted[i];
            const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
            if (cross <= 0) {
                hull.pop();
            } else {
                break;
            }
        }
        hull.push(sorted[i]);
    }

    return hull;
}

function drawSwarms() {
    const time = Date.now() / 1000;

    for (const swarm of appState.swarms) {
        const positions = swarm.positions;
        if (!positions || positions.length < 2) continue;

        // Compute convex hull
        const pts = positions.map(p => [p[0], p[1]]);
        const hull = convexHull(pts);

        if (hull.length < 2) continue;

        // Pulsing effect
        const pulseAlpha = 0.15 + 0.1 * Math.sin(time * 3);

        // Choose color by coherence
        let fillColor, strokeColor;
        if (swarm.coherence > 0.7) {
            fillColor = `rgba(57, 255, 20, ${pulseAlpha})`;
            strokeColor = 'rgba(57, 255, 20, 0.6)';
        } else if (swarm.coherence > 0.4) {
            fillColor = `rgba(255, 171, 0, ${pulseAlpha})`;
            strokeColor = 'rgba(255, 171, 0, 0.5)';
        } else {
            fillColor = `rgba(255, 23, 68, ${pulseAlpha})`;
            strokeColor = 'rgba(255, 23, 68, 0.4)';
        }

        // Draw hull fill
        ctx.beginPath();
        ctx.moveTo(hull[0][0], hull[0][1]);
        for (let i = 1; i < hull.length; i++) {
            ctx.lineTo(hull[i][0], hull[i][1]);
        }
        ctx.closePath();
        ctx.fillStyle = fillColor;
        ctx.fill();

        // Draw hull border
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(hull[0][0], hull[0][1]);
        for (let i = 1; i < hull.length; i++) {
            ctx.lineTo(hull[i][0], hull[i][1]);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);

        // Swarm label
        const cx = swarm.center[0];
        const cy = swarm.center[1];

        ctx.fillStyle = 'rgba(57, 255, 20, 0.8)';
        ctx.font = 'bold 10px "JetBrains Mono"';
        ctx.textAlign = 'center';
        ctx.fillText(`SWARM ${swarm.swarm_id}`, cx, cy - 18);

        ctx.fillStyle = 'rgba(57, 255, 20, 0.5)';
        ctx.font = '9px "JetBrains Mono"';
        ctx.fillText(`${swarm.formation.toUpperCase()} • ${swarm.member_ids.length} drones`, cx, cy - 6);

        // Center marker
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.swarmCenter;
        ctx.fill();
    }
}

function drawFrame() {
    drawGrid();
    drawSwarms();
    drawTrails();
    drawPredictions();
    drawTracks();
    requestAnimationFrame(drawFrame);
}

// --- UI Updates ---
function updateStatsPanel() {
    const s = appState.stats;
    document.getElementById('stat-tick').textContent = s.tick ?? '—';
    document.getElementById('stat-detections').textContent = s.num_detections ?? '—';
    document.getElementById('stat-tracks').textContent = s.num_tracks ?? '—';
    document.getElementById('stat-confirmed').textContent = s.num_confirmed ?? '—';
    document.getElementById('stat-swarms').textContent = s.num_swarms ?? '—';
}

function updateSwarmPanel() {
    const container = document.getElementById('swarm-details');

    if (appState.swarms.length === 0) {
        container.innerHTML = '<p class="no-data">No swarms detected</p>';
        return;
    }

    let html = '';
    for (const swarm of appState.swarms) {
        const coherenceClass = swarm.coherence > 0.7 ? 'high'
            : swarm.coherence > 0.4 ? 'medium' : 'low';
        const coordinated = swarm.is_coordinated ? '✓ Coordinated' : '✗ Uncoordinated';

        html += `
            <div class="swarm-entry ${swarm.coherence < 0.5 ? 'low-coherence' : ''}">
                <div class="swarm-entry-header">
                    <span class="swarm-entry-title">Swarm ${swarm.swarm_id}</span>
                    <span class="swarm-coherence-badge ${coherenceClass}">
                        ${(swarm.coherence * 100).toFixed(0)}%
                    </span>
                </div>
                <div class="swarm-meta">
                    <strong>Drones:</strong> ${swarm.member_ids.length}<br>
                    <strong>Formation:</strong> ${swarm.formation}<br>
                    <strong>Status:</strong> ${coordinated}<br>
                    <strong>Center:</strong> (${swarm.center[0]}, ${swarm.center[1]})
                </div>
            </div>
        `;
    }
    container.innerHTML = html;
}

// --- Controls ---
toggleBtn.addEventListener('click', () => {
    appState.paused = !appState.paused;
    toggleIcon.textContent = appState.paused ? '▶' : '⏸';
    toggleText.textContent = appState.paused ? 'RESUME' : 'PAUSE';
    sendCommand({ command: 'toggle' });
});

scenarioSelect.addEventListener('change', (e) => {
    sendCommand({ command: 'set_scenario', scenario: e.target.value });
    // Clear trails on scenario change
    for (const key of Object.keys(appState.trails)) {
        delete appState.trails[key];
    }
});

// Keyboard shortcut: Space = toggle
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        toggleBtn.click();
    }
});

// --- Clock ---
function updateClock() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('en-US', { hour12: false });
    setTimeout(updateClock, 1000);
}

// --- Init ---
function init() {
    connectWebSocket();
    updateClock();
    requestAnimationFrame(drawFrame);
}

init();
