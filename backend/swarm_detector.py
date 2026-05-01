"""
Swarm detection using DBSCAN clustering, velocity-coherence scoring,
and formation shape classification.
"""

import numpy as np
from sklearn.cluster import DBSCAN

# --- Configuration ---
DBSCAN_MIN_SAMPLES = 2       # Minimum drones to form a swarm
DBSCAN_EPS_CLAMP = (20, 200) # Min/max epsilon range
COHERENCE_THRESHOLD = 0.5    # Min cosine similarity to be "coordinated"


def adaptive_eps(positions):
    """Compute adaptive DBSCAN eps based on median nearest-neighbor distance."""
    if len(positions) < 2:
        return DBSCAN_EPS_CLAMP[1]

    from scipy.spatial.distance import cdist
    dists = cdist(positions, positions)
    np.fill_diagonal(dists, np.inf)
    nn_dists = dists.min(axis=1)
    eps = float(np.median(nn_dists)) * 2.0
    return np.clip(eps, *DBSCAN_EPS_CLAMP)


def compute_coherence(velocities):
    """
    Compute velocity-alignment score for a group of drones.
    Returns average pairwise cosine similarity of velocity vectors.
    1.0 = all moving same direction, 0.0 = random directions.
    """
    if len(velocities) < 2:
        return 0.0

    scores = []
    for i in range(len(velocities)):
        for j in range(i + 1, len(velocities)):
            v1 = velocities[i]
            v2 = velocities[j]
            norm1 = np.linalg.norm(v1)
            norm2 = np.linalg.norm(v2)
            if norm1 < 1e-6 or norm2 < 1e-6:
                continue
            cos_sim = np.dot(v1, v2) / (norm1 * norm2)
            scores.append(cos_sim)

    return float(np.mean(scores)) if scores else 0.0


def classify_formation(positions):
    """
    Classify swarm formation shape using PCA on member positions.
    Returns: 'line', 'v_shape', or 'cluster'.
    """
    if len(positions) < 3:
        return "cluster"

    positions = np.array(positions)
    centered = positions - positions.mean(axis=0)

    # PCA via covariance eigendecomposition
    cov = np.cov(centered.T)
    eigenvalues = np.linalg.eigvalsh(cov)
    eigenvalues = np.sort(eigenvalues)[::-1]  # Descending

    if eigenvalues[1] < 1e-6:
        return "line"

    ratio = eigenvalues[0] / eigenvalues[1]

    if ratio > 5.0:
        return "line"
    elif ratio > 2.5:
        return "v_shape"
    else:
        return "cluster"


def detect_swarms(tracks):
    """
    Given a list of confirmed track dicts [{track_id, x, y, vx, vy, ...}],
    detect swarm clusters and return enriched swarm info.

    Returns list of swarm dicts:
    [{
        swarm_id: int,
        member_ids: [int, ...],
        positions: [[x, y], ...],
        center: [x, y],
        coherence: float,
        formation: str,
    }]
    """
    if len(tracks) < DBSCAN_MIN_SAMPLES:
        return []

    positions = np.array([[t["x"], t["y"]] for t in tracks])
    velocities = np.array([[t["vx"], t["vy"]] for t in tracks])

    eps = adaptive_eps(positions)
    db = DBSCAN(eps=eps, min_samples=DBSCAN_MIN_SAMPLES).fit(positions)
    labels = db.labels_

    swarms = []
    unique_labels = set(labels)
    unique_labels.discard(-1)  # Remove noise label

    for swarm_id, label in enumerate(sorted(unique_labels)):
        mask = labels == label
        member_positions = positions[mask].tolist()
        member_velocities = velocities[mask]
        member_ids = [tracks[i]["track_id"] for i in range(len(tracks)) if mask[i]]

        center = positions[mask].mean(axis=0).tolist()
        coherence = compute_coherence(member_velocities)
        formation = classify_formation(member_positions)

        swarms.append({
            "swarm_id": swarm_id,
            "member_ids": member_ids,
            "positions": member_positions,
            "center": [round(center[0], 2), round(center[1], 2)],
            "coherence": round(coherence, 3),
            "formation": formation,
            "is_coordinated": coherence > COHERENCE_THRESHOLD,
        })

    return swarms


if __name__ == "__main__":
    import sys
    sys.path.insert(0, ".")
    from simulator import Scenario
    from tracker import MultiTracker, KalmanTrack

    # Reset track IDs
    KalmanTrack._next_track_id = 0

    scenario = Scenario("large_swarm")
    mt = MultiTracker()

    # Run a few ticks to build up tracks
    for _ in range(10):
        dets = scenario.tick()
        mt.update(dets)

    # Now detect swarms
    confirmed = mt.update(scenario.tick())
    swarms = detect_swarms(confirmed)

    print(f"Detected {len(swarms)} swarm(s) from {len(confirmed)} confirmed tracks:\n")
    for s in swarms:
        print(f"  Swarm {s['swarm_id']}:")
        print(f"    Members: {s['member_ids']} ({len(s['member_ids'])} drones)")
        print(f"    Center: ({s['center'][0]}, {s['center'][1]})")
        print(f"    Coherence: {s['coherence']}")
        print(f"    Formation: {s['formation']}")
        print(f"    Coordinated: {s['is_coordinated']}")
        print()

    # Show which tracks are NOT in any swarm
    all_ids = {t["track_id"] for t in confirmed}
    swarm_ids = set()
    for s in swarms:
        swarm_ids.update(s["member_ids"])
    independent = all_ids - swarm_ids
    print(f"  Independent drones (not in swarm): {sorted(independent)}")
