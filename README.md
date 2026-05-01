# SkyNet Sentinel — Drone Swarm Detection System

Real-time drone swarm detection, tracking, and visualization MVP.

![Python](https://img.shields.io/badge/Python-3.12-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## Features

- **Simulated radar data** — synthetic drone detections at 10 Hz with configurable noise
- **Multi-target tracking** — Kalman filters + Hungarian algorithm assignment
- **Swarm detection** — DBSCAN clustering with adaptive epsilon
- **Velocity coherence** — distinguishes coordinated swarms from coincidental groupings
- **Formation classification** — PCA-based shape analysis (line, V-shape, cluster)
- **Trajectory prediction** — 5-second lookahead via linear extrapolation
- **Real-time dashboard** — dark radar-themed web UI with live updates
- **3 scenario presets** — single drone, small swarm (3), large swarm (10+2)

## Quick Start

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Start the server

```bash
python3 backend/server.py
```

### 3. Open the dashboard

Navigate to **http://localhost:8080** in your browser.

## Controls

| Control | Action |
|---------|--------|
| **Scenario dropdown** | Switch between `single`, `small_swarm`, `large_swarm` |
| **Pause/Resume button** | Toggle simulation |
| **Spacebar** | Keyboard shortcut for pause/resume |

## Architecture

```
Simulator → Tracker → Swarm Detector → Predictor → WebSocket → Browser
  (10 Hz)    (Kalman)    (DBSCAN)       (Linear)    (JSON)     (Canvas)
```

## File Structure

```
drone-swarm/
├── backend/
│   ├── simulator.py       # Drone + Swarm + Scenario classes
│   ├── tracker.py         # KalmanTrack + MultiTracker (Hungarian)
│   ├── swarm_detector.py  # DBSCAN + coherence + formation
│   ├── predictor.py       # Linear trajectory extrapolation
│   ├── pipeline.py        # Orchestrator
│   └── server.py          # WebSocket + HTTP server
├── frontend/
│   ├── index.html         # Dashboard layout
│   ├── style.css          # Dark radar theme
│   └── main.js            # Canvas rendering + WS client
├── requirements.txt
└── README.md
```

## Tech Stack

- **Backend**: Python 3.12, numpy, scipy, scikit-learn, websockets
- **Frontend**: Vanilla HTML/CSS/JS, HTML5 Canvas
- **Communication**: WebSocket (JSON at 10 Hz)
- **No frameworks. No build tools. No npm.**
