"""
MISC-04 — Coordination Layer Configuration (Member B)
All tunable numbers, weights, and thresholds in one place.
"""

TIMESTEPS = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"]

# Must match Member A's pd.cut bins: low <= 0.33 < medium <= 0.66 < high
LOW_MAX, HIGH_MIN = 0.33, 0.66

# Road closure rule: closed if mean of the two endpoint risk scores >= this
ROAD_CLOSE_MEAN_RISK = 0.66

# Ground reports (heuristic weights, NOT from literature)
REPORT_BOOST = {"flooded_road": 0.10, "stranded_people": 0.15, "other": 0.05}
REPORT_BOOST_CAP = 0.20          # max total boost per settlement per timestep
REPORT_ACTIVE_STEPS = 3          # a report is active at its timestep + next 2

# Priority = W_RISK*risk + W_POP*pop_norm + W_ISO*(1 - road_accessibility)
W_RISK, W_POP, W_ISO = 0.5, 0.3, 0.2

LITERATURE_WEIGHTS = {
    "rainfall_mm": 0.35,
    "elevation_m": 0.30,
    "distance_to_river_km": 0.20,
    "historical_flood_flag": 0.15
}
