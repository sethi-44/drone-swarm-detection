"""
Pipeline orchestrator wiring simulator -> tracker -> swarm detector -> predictor.
"""

import json
import time
import sys
sys.path.insert(0, ".")

from simulator import Scenario, Drone
from tracker import MultiTracker, KalmanTrack
from swarm_detector import detect_swarms
from predictor import predict_all


class Pipeline:
    """Orchestrates the full detection/tracking/analysis pipeline."""

    def __init__(self, scenario_name="large_swarm"):
        # Reset IDs
        Drone._next_id = 0
        KalmanTrack._next_track_id = 0

        self.scenario = Scenario(scenario_name)
        self.tracker = MultiTracker()
        self.tick_count = 0
        self.running = True

    def set_scenario(self, scenario_name):
        """Switch to a new scenario, resetting all state."""
        Drone._next_id = 0
        KalmanTrack._next_track_id = 0
        self.scenario = Scenario(scenario_name)
        self.tracker = MultiTracker()
        self.tick_count = 0

    def tick(self):
        """Run one pipeline step. Returns JSON-serializable dict."""
        if not self.running:
            return None

        # 1. Get raw detections from simulator
        detections = self.scenario.tick()

        # 2. Feed to multi-target tracker
        confirmed = self.tracker.update(detections)
        all_tracks = self.tracker.get_all_tracks()

        # 3. Detect swarms from confirmed tracks
        swarms = detect_swarms(confirmed)

        # 4. Predict trajectories for confirmed tracks
        predictions = predict_all(confirmed, steps=5)

        # 5. Compute stats
        stats = {
            "tick": self.tick_count,
            "timestamp": round(time.time(), 3),
            "num_detections": len(detections),
            "num_tracks": len(all_tracks),
            "num_confirmed": len(confirmed),
            "num_swarms": len(swarms),
        }

        self.tick_count += 1

        return {
            "tracks": all_tracks,
            "swarms": swarms,
            "predictions": predictions,
            "stats": stats,
        }


if __name__ == "__main__":
    pipeline = Pipeline("large_swarm")

    print("Pipeline integration test (20 ticks):\n")
    for i in range(20):
        result = pipeline.tick()
        s = result["stats"]
        n_swarms = len(result["swarms"])
        n_preds = len(result["predictions"])

        swarm_info = ""
        if n_swarms > 0:
            sw = result["swarms"][0]
            swarm_info = f" | swarm: {len(sw['member_ids'])} members, coherence={sw['coherence']}, form={sw['formation']}"

        print(f"  tick {s['tick']:2d}: "
              f"dets={s['num_detections']}, "
              f"tracks={s['num_tracks']}, "
              f"confirmed={s['num_confirmed']}, "
              f"swarms={n_swarms}, "
              f"preds={n_preds}"
              f"{swarm_info}")

    # Print one full JSON payload
    result = pipeline.tick()
    print(f"\n--- Sample JSON payload (tick {result['stats']['tick']}) ---")
    print(json.dumps(result, indent=2)[:1500] + "\n...")
