"""
MISC-04 — Real Road Routing Client (OSRM)
Fetches actual road-following routes from the free OSRM public routing server.
Results are cached to data/road_geometries.json so live demos never depend on
OSRM being reachable in the moment.
"""

import requests
import json
import math
import time
from pathlib import Path

OSRM_BASE = "https://router.project-osrm.org/route/v1/driving"
CACHE_PATH = Path(__file__).resolve().parent.parent / "data" / "road_geometries.json"


def _load_cache():
    if CACHE_PATH.exists():
        with open(CACHE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def _save_cache(cache):
    with open(CACHE_PATH, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2)


def get_real_route(coord_from, coord_to, cache_key):
    """
    coord_from / coord_to = (lat, lng).
    Returns dict with distance_km, duration_min, geometry (list of [lat, lng] pairs),
    and source ("osrm" or "straight_line_fallback"). Caches by cache_key.
    Returns None on complete failure.
    """
    cache = _load_cache()
    if cache_key in cache:
        return cache[cache_key]

    lat1, lng1 = coord_from
    lat2, lng2 = coord_to
    # OSRM expects lng,lat order
    url = f"{OSRM_BASE}/{lng1},{lat1};{lng2},{lat2}"
    try:
        r = requests.get(
            url,
            params={"overview": "full", "geometries": "geojson"},
            timeout=8
        )
        data = r.json()
        if data.get("code") != "Ok":
            print(f"[OSRM] failed for {cache_key}: {data.get('code')}")
            return None
        route = data["routes"][0]
        result = {
            "distance_km": round(route["distance"] / 1000, 2),
            "duration_min": round(route["duration"] / 60, 1),
            # OSRM returns [lng, lat]; convert to [lat, lng] for Leaflet
            "geometry": [[lat, lng] for lng, lat in route["geometry"]["coordinates"]],
            "source": "osrm"
        }
    except Exception as e:
        print(f"[OSRM] error for {cache_key}: {e}")
        return None

    cache[cache_key] = result
    _save_cache(cache)
    time.sleep(0.3)  # be polite to the free public server
    return result


def haversine_fallback(coord_from, coord_to):
    """Used only if OSRM is unreachable — straight-line, clearly flagged as fallback."""
    R = 6371.0
    la1, lo1, la2, lo2 = map(math.radians, [*coord_from, *coord_to])
    d = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    dist = 2 * R * math.asin(math.sqrt(d))
    return {
        "distance_km": round(dist, 2),
        "duration_min": round(dist / 40 * 60, 1),  # assume 40km/h average for mountain roads
        "geometry": [list(coord_from), list(coord_to)],
        "source": "straight_line_fallback"
    }
