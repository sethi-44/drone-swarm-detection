"""
Trajectory predictor using linear extrapolation from Kalman filter state.
"""


def predict_trajectory(track_dict, steps=5):
    """
    Given a track dict {x, y, vx, vy, ...}, predict future positions.
    Returns list of (x, y) tuples at t=1,2,...,steps seconds ahead.
    """
    x = track_dict["x"]
    y = track_dict["y"]
    vx = track_dict["vx"]
    vy = track_dict["vy"]

    predictions = []
    for t in range(1, steps + 1):
        px = round(x + vx * t, 2)
        py = round(y + vy * t, 2)
        predictions.append({"x": px, "y": py, "t": t})

    return predictions


def predict_all(tracks, steps=5):
    """
    Predict trajectories for all tracks.
    Returns dict: {track_id: [predicted_points]}
    """
    result = {}
    for t in tracks:
        result[t["track_id"]] = predict_trajectory(t, steps)
    return result


if __name__ == "__main__":
    # Test with known values
    track = {"track_id": 0, "x": 100, "y": 100, "vx": 10, "vy": 5}
    preds = predict_trajectory(track)

    print("Trajectory prediction test:")
    print(f"  Start: ({track['x']}, {track['y']}), velocity: ({track['vx']}, {track['vy']})")
    print(f"  Predictions:")
    for p in preds:
        print(f"    t={p['t']}: ({p['x']}, {p['y']})")

    expected = [(110, 105), (120, 110), (130, 115), (140, 120), (150, 125)]
    actual = [(p["x"], p["y"]) for p in preds]
    assert actual == expected, f"FAIL: expected {expected}, got {actual}"
    print("\n  ✓ All predictions correct!")
