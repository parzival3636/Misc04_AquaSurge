"""
MISC-04 — Helper script to discover report target candidates.
Run: python -m scripts.suggest_report_targets (from inside backend/)
"""

from services.pipeline import load_settlements
from services.config import *

S = load_settlements()
print("Settlement targets where a ground report can demonstrably flip risk from MEDIUM to HIGH:")
print("-" * 70)
for t in TIMESTEPS:
    for s in S.values():
        m = s["model_risk_score"][t]
        if HIGH_MIN - 0.15 <= m <= HIGH_MIN:
            print(f"{t} [{s['id']}] {s['name']:<18} model score {m:.3f} -> a report could tip this to HIGH")
