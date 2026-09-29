"""
MISC-04 — Pre-fetch real road geometries from OSRM.
Run ONCE:  python -m scripts.fetch_road_geometries
This populates data/road_geometries.json. All later requests read from cache.
"""

import json
import sys
from pathlib import Path

# Ensure backend/ is on the path when run as a module
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.pipeline import load_settlements
from services.routing_client import get_real_route, haversine_fallback, CACHE_PATH

DATA = Path(__file__).resolve().parent.parent / "data"


def main():
    S = load_settlements()
    name2id = {s["name"]: sid for sid, s in S.items()}

    with open(DATA / "roads_seed.json", "r", encoding="utf-8") as f:
        pairs = json.load(f)

    ok = fallback = skipped = 0
    for a, b in pairs:
        if a not in name2id or b not in name2id:
            print(f"  SKIP  {a} -> {b}: not in dataset")
            skipped += 1
            continue
        A, B = S[name2id[a]], S[name2id[b]]
        key = f"{A['id']}_{B['id']}"
        result = get_real_route((A["lat"], A["lng"]), (B["lat"], B["lng"]), key)
        if result and result["source"] == "osrm":
            pts = len(result["geometry"])
            print(f"  OK    {a:20s} -> {b:20s}  {result['distance_km']:6.2f} km  {result['duration_min']:5.1f} min  ({pts} pts)")
            ok += 1
        else:
            # OSRM failed, store a fallback so we have *something*
            fb = haversine_fallback((A["lat"], A["lng"]), (B["lat"], B["lng"]))
            from services.routing_client import _load_cache, _save_cache
            cache = _load_cache()
            cache[key] = fb
            _save_cache(cache)
            print(f"  FALLBACK  {a:20s} -> {b:20s}  {fb['distance_km']:6.2f} km (straight line)")
            fallback += 1

    # Also pre-fetch depot-to-settlement routes for unit assignment (Part 3)
    depot_coord = (11.6103, 76.0827)  # Kalpetta (District HQ)
    print(f"\n--- Depot Routes (from Kalpetta) ---")
    for sid, s in S.items():
        key = f"depot_{sid}"
        result = get_real_route(depot_coord, (s["lat"], s["lng"]), key)
        if result and result["source"] == "osrm":
            print(f"  OK    Depot -> {s['name']:20s}  {result['distance_km']:6.2f} km  {result['duration_min']:5.1f} min")
            ok += 1
        else:
            fb = haversine_fallback(depot_coord, (s["lat"], s["lng"]))
            from services.routing_client import _load_cache, _save_cache
            cache = _load_cache()
            cache[key] = fb
            _save_cache(cache)
            print(f"  FALLBACK  Depot -> {s['name']:20s}  {fb['distance_km']:6.2f} km (straight line)")
            fallback += 1

    print(f"\nDone. OSRM: {ok}  Fallback: {fallback}  Skipped: {skipped}")
    print(f"Cache file: {CACHE_PATH}")


if __name__ == "__main__":
    main()
