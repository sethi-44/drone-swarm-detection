"""
Multi-target tracker using Kalman filters and Hungarian algorithm assignment.
"""

import numpy as np

# --- Configuration ---
GATING_THRESHOLD = 50.0   # Max distance to associate detection to track (pixels)
HITS_TO_CONFIRM = 3       # Consecutive hits before track is confirmed
MISSES_TO_DELETE = 5       # Consecutive misses before track is deleted


class KalmanTrack:
    """Kalman filter for a single target. State: [x, y, vx, vy]."""

    _next_track_id = 0

    def __init__(self, x, y):
        self.track_id = KalmanTrack._next_track_id
        KalmanTrack._next_track_id += 1

        # State: [x, y, vx, vy]
        self.state = np.array([x, y, 0.0, 0.0], dtype=np.float64)

        # State covariance
        self.P = np.diag([100.0, 100.0, 50.0, 50.0])

        # Transition matrix (constant velocity)
        self.F = np.array([
            [1, 0, 1, 0],
            [0, 1, 0, 1],
            [0, 0, 1, 0],
            [0, 0, 0, 1],
        ], dtype=np.float64)

        # Measurement matrix (observe x, y only)
        self.H = np.array([
            [1, 0, 0, 0],
            [0, 1, 0, 0],
        ], dtype=np.float64)

        # Process noise
        self.Q = np.diag([1.0, 1.0, 0.5, 0.5])

        # Measurement noise
        self.R = np.diag([25.0, 25.0])  # NOISE_STD^2

        # Track lifecycle
        self.hits = 1
        self.misses = 0
        self.confirmed = False

    def predict(self):
        """Predict next state."""
        self.state = self.F @ self.state
        self.P = self.F @ self.P @ self.F.T + self.Q
        return self.state[:2].copy()

    def update(self, z):
        """Update state with measurement z = [x, y]."""
        z = np.array(z, dtype=np.float64)
        y = z - self.H @ self.state           # Innovation
        S = self.H @ self.P @ self.H.T + self.R  # Innovation covariance
        K = self.P @ self.H.T @ np.linalg.inv(S)  # Kalman gain
        self.state = self.state + K @ y
        self.P = (np.eye(4) - K @ self.H) @ self.P

        self.hits += 1
        self.misses = 0
        if self.hits >= HITS_TO_CONFIRM:
            self.confirmed = True

    def mark_missed(self):
        """Mark this track as missed this frame."""
        self.misses += 1

    def is_dead(self):
        """Check if track should be deleted."""
        return self.misses >= MISSES_TO_DELETE

    def get_position(self):
        return self.state[0], self.state[1]

    def get_velocity(self):
        return self.state[2], self.state[3]

    def to_dict(self):
        return {
            "track_id": self.track_id,
            "x": round(self.state[0], 2),
            "y": round(self.state[1], 2),
            "vx": round(self.state[2], 2),
            "vy": round(self.state[3], 2),
            "confirmed": self.confirmed,
        }


class MultiTracker:
    """Manages multiple KalmanTrack instances with Hungarian assignment."""

    def __init__(self):
        self.tracks = []

    def update(self, detections):
        """
        Process a list of detections: [{x, y, ...}, ...].
        Returns list of confirmed track dicts.
        """
        from scipy.optimize import linear_sum_assignment

        # 1. Predict all existing tracks
        predictions = []
        for track in self.tracks:
            pred = track.predict()
            predictions.append(pred)

        # 2. Build cost matrix (Euclidean distance)
        num_tracks = len(self.tracks)
        num_dets = len(detections)

        if num_tracks == 0 and num_dets == 0:
            return self._get_confirmed()

        if num_tracks == 0:
            # Create new tracks for all detections
            for det in detections:
                self.tracks.append(KalmanTrack(det["x"], det["y"]))
            return self._get_confirmed()

        if num_dets == 0:
            # All tracks missed
            for track in self.tracks:
                track.mark_missed()
            self._prune_dead()
            return self._get_confirmed()

        # Build cost matrix
        cost = np.zeros((num_tracks, num_dets))
        for i, pred in enumerate(predictions):
            for j, det in enumerate(detections):
                cost[i, j] = np.sqrt((pred[0] - det["x"])**2 + (pred[1] - det["y"])**2)

        # 3. Solve assignment
        row_idx, col_idx = linear_sum_assignment(cost)

        matched_tracks = set()
        matched_dets = set()

        for r, c in zip(row_idx, col_idx):
            if cost[r, c] < GATING_THRESHOLD:
                self.tracks[r].update([detections[c]["x"], detections[c]["y"]])
                matched_tracks.add(r)
                matched_dets.add(c)

        # 4. Mark unmatched tracks as missed
        for i in range(num_tracks):
            if i not in matched_tracks:
                self.tracks[i].mark_missed()

        # 5. Create new tracks for unmatched detections
        for j in range(num_dets):
            if j not in matched_dets:
                self.tracks.append(KalmanTrack(detections[j]["x"], detections[j]["y"]))

        # 6. Prune dead tracks
        self._prune_dead()

        return self._get_confirmed()

    def _get_confirmed(self):
        """Return list of confirmed track dicts."""
        return [t.to_dict() for t in self.tracks if t.confirmed]

    def get_all_tracks(self):
        """Return all tracks (confirmed + tentative) as dicts."""
        return [t.to_dict() for t in self.tracks]

    def _prune_dead(self):
        """Remove tracks that have been missed too many times."""
        self.tracks = [t for t in self.tracks if not t.is_dead()]


if __name__ == "__main__":
    import sys
    sys.path.insert(0, ".")
    from simulator import Scenario

    scenario = Scenario("large_swarm")
    mt = MultiTracker()

    print("Multi-target tracking test (large_swarm: 10 swarm + 2 independent):")
    for tick_num in range(15):
        dets = scenario.tick()
        confirmed = mt.update(dets)
        all_tracks = mt.get_all_tracks()
        n_confirmed = len(confirmed)
        n_total = len(all_tracks)
        print(f"  tick {tick_num:2d}: {len(dets)} detections -> {n_total} total tracks, {n_confirmed} confirmed")

    print(f"\nFinal confirmed tracks:")
    for t in mt.update(scenario.tick()):
        print(f"  track {t['track_id']:2d}: x={t['x']:7.2f} y={t['y']:7.2f} vx={t['vx']:6.2f} vy={t['vy']:6.2f}")
