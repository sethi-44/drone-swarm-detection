"""
Drone flight simulator.
Generates synthetic drone detections with configurable noise and swarm behavior.
"""

import numpy as np
import time

# --- Configuration ---
WORLD_W = 800
WORLD_H = 600
NOISE_STD = 5.0          # Gaussian noise on position (pixels)
SPEED_MIN = 2.0          # Min drone speed (pixels/tick)
SPEED_MAX = 5.0          # Max drone speed (pixels/tick)
HEADING_CHANGE_INTERVAL = (50, 100)  # Ticks between random heading changes
SWARM_JITTER_STD = 3.0   # Jitter for swarm members around formation position


class Drone:
    """A single drone that moves in a straight line with slight random noise."""

    _next_id = 0

    def __init__(self, x=None, y=None, speed=None, heading=None, drone_id=None):
        if drone_id is not None:
            self.id = drone_id
        else:
            self.id = Drone._next_id
        Drone._next_id += 1

        self.x = x if x is not None else np.random.uniform(50, WORLD_W - 50)
        self.y = y if y is not None else np.random.uniform(50, WORLD_H - 50)
        self.speed = speed if speed is not None else np.random.uniform(SPEED_MIN, SPEED_MAX)
        self.heading = heading if heading is not None else np.random.uniform(0, 2 * np.pi)

        # Ticks until next heading change
        self._heading_timer = np.random.randint(*HEADING_CHANGE_INTERVAL)

    def tick(self):
        """Advance one time step. Returns a detection dict with noisy position."""
        # Update heading timer
        self._heading_timer -= 1
        if self._heading_timer <= 0:
            self.heading += np.random.uniform(-np.pi / 4, np.pi / 4)
            self._heading_timer = np.random.randint(*HEADING_CHANGE_INTERVAL)

        # Compute velocity
        vx = self.speed * np.cos(self.heading)
        vy = self.speed * np.sin(self.heading)

        # Update true position
        self.x += vx
        self.y += vy

        # Wrap around world boundaries
        self.x = self.x % WORLD_W
        self.y = self.y % WORLD_H

        # Add measurement noise
        noisy_x = self.x + np.random.normal(0, NOISE_STD)
        noisy_y = self.y + np.random.normal(0, NOISE_STD)

        return {
            "id": self.id,
            "x": round(noisy_x, 2),
            "y": round(noisy_y, 2),
            "vx": round(vx, 2),
            "vy": round(vy, 2),
            "timestamp": time.time(),
        }


class Swarm:
    """A group of drones flying in coordinated formation around a moving center."""

    def __init__(self, num_drones, center_x=None, center_y=None, speed=None, heading=None, formation="cluster"):
        self.center_x = center_x if center_x is not None else np.random.uniform(100, WORLD_W - 100)
        self.center_y = center_y if center_y is not None else np.random.uniform(100, WORLD_H - 100)
        self.speed = speed if speed is not None else np.random.uniform(SPEED_MIN, SPEED_MAX)
        self.heading = heading if heading is not None else np.random.uniform(0, 2 * np.pi)
        self.num_drones = num_drones

        # Ticks until center heading change
        self._heading_timer = np.random.randint(*HEADING_CHANGE_INTERVAL)

        # Generate formation offsets relative to center
        self.offsets = self._make_formation(num_drones, formation)

        # Assign IDs
        self.drone_ids = list(range(Drone._next_id, Drone._next_id + num_drones))
        Drone._next_id += num_drones

    def _make_formation(self, n, formation):
        """Generate (dx, dy) offsets for each drone in the formation."""
        offsets = []
        if formation == "line":
            spacing = 30
            for i in range(n):
                offsets.append((0, (i - n // 2) * spacing))
        elif formation == "v_shape":
            spacing = 30
            for i in range(n):
                side = 1 if i % 2 == 0 else -1
                depth = (i + 1) // 2
                offsets.append((depth * spacing, side * depth * spacing * 0.6))
        else:  # cluster
            for _ in range(n):
                offsets.append((np.random.uniform(-40, 40), np.random.uniform(-40, 40)))
        return offsets

    def tick(self):
        """Advance one time step. Returns list of detection dicts for all drones."""
        # Update center heading
        self._heading_timer -= 1
        if self._heading_timer <= 0:
            self.heading += np.random.uniform(-np.pi / 6, np.pi / 6)
            self._heading_timer = np.random.randint(*HEADING_CHANGE_INTERVAL)

        # Move center
        vx = self.speed * np.cos(self.heading)
        vy = self.speed * np.sin(self.heading)
        self.center_x = (self.center_x + vx) % WORLD_W
        self.center_y = (self.center_y + vy) % WORLD_H

        detections = []
        for i, (dx, dy) in enumerate(self.offsets):
            # Rotate offset by heading
            cos_h = np.cos(self.heading)
            sin_h = np.sin(self.heading)
            rot_dx = dx * cos_h - dy * sin_h
            rot_dy = dx * sin_h + dy * cos_h

            # True position = center + rotated offset + jitter
            true_x = self.center_x + rot_dx + np.random.normal(0, SWARM_JITTER_STD)
            true_y = self.center_y + rot_dy + np.random.normal(0, SWARM_JITTER_STD)

            # Wrap
            true_x = true_x % WORLD_W
            true_y = true_y % WORLD_H

            # Add measurement noise
            noisy_x = true_x + np.random.normal(0, NOISE_STD)
            noisy_y = true_y + np.random.normal(0, NOISE_STD)

            detections.append({
                "id": self.drone_ids[i],
                "x": round(noisy_x, 2),
                "y": round(noisy_y, 2),
                "vx": round(vx, 2),
                "vy": round(vy, 2),
                "timestamp": time.time(),
            })

        return detections


class Scenario:
    """Preset scenarios for testing. Creates drones and swarms."""

    PRESETS = {
        "single": {"swarms": [], "independents": 1},
        "small_swarm": {"swarms": [{"n": 3, "formation": "v_shape"}], "independents": 0},
        "large_swarm": {"swarms": [{"n": 10, "formation": "cluster"}], "independents": 2},
    }

    def __init__(self, preset_name="large_swarm"):
        Drone._next_id = 0  # Reset IDs
        config = self.PRESETS[preset_name]

        self.swarms = []
        for s_cfg in config["swarms"]:
            self.swarms.append(Swarm(num_drones=s_cfg["n"], formation=s_cfg["formation"]))

        self.independents = []
        for _ in range(config["independents"]):
            self.independents.append(Drone())

    def tick(self):
        """Advance all drones one step. Returns flat list of all detections."""
        detections = []
        for swarm in self.swarms:
            detections.extend(swarm.tick())
        for drone in self.independents:
            detections.append(drone.tick())
        return detections


if __name__ == "__main__":
    import sys
    preset = sys.argv[1] if len(sys.argv) > 1 else "large_swarm"
    print(f"Scenario: {preset}")

    scenario = Scenario(preset)
    for tick_num in range(10):
        dets = scenario.tick()
        print(f"\n--- Tick {tick_num} ({len(dets)} detections) ---")
        for d in dets:
            print(f"  drone {d['id']:2d}: x={d['x']:7.2f}  y={d['y']:7.2f}  vx={d['vx']:6.2f}  vy={d['vy']:6.2f}")
