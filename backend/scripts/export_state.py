"""
MISC-04 — Export State Fallback Script (Member B)
Exports complete coordination state to data/state.json and frontend/state.json.
Run: python -m scripts.export_state (from inside backend/)
"""

import json
from pathlib import Path
from services.pipeline import get_state

BASE = Path(__file__).resolve().parent.parent
data_out = BASE / "data" / "state.json"
frontend_out = BASE.parent / "frontend" / "state.json"
root_out = BASE.parent / "state.json"

st = get_state()

with open(data_out, "w", encoding="utf-8") as f:
    json.dump(st, f, indent=2)
print(f"[OK] Wrote {data_out}")

if frontend_out.parent.exists():
    with open(frontend_out, "w", encoding="utf-8") as f:
        json.dump(st, f, indent=2)
    print(f"[OK] Wrote {frontend_out}")

    js_out = frontend_out.parent / "state_data.js"
    with open(js_out, "w", encoding="utf-8") as f:
        f.write("window.DEFAULT_STATE = " + json.dumps(st, indent=2) + ";\n")
    print(f"[OK] Wrote {js_out}")

if root_out.parent.exists():
    with open(root_out, "w", encoding="utf-8") as f:
        json.dump(st, f, indent=2)
    print(f"[OK] Wrote {root_out}")
