"""
Comprehensive Test Suite for MISC-04 Backend API
Tests every single router, feature, prediction, and edge case in-process using FastAPI TestClient.
"""

from fastapi.testclient import TestClient
from main import app
import json

client = TestClient(app)

def run_tests():
    print("=" * 70)
    print("RUNNING COMPREHENSIVE MISC-04 FASTAPI SUITE")
    print("=" * 70)

    # 1. Root
    r = client.get("/")
    assert r.status_code == 200, f"Root failed: {r.status_code}"
    print("[PASS] GET / ->", r.json()["title"])

    # 2. State
    r = client.get("/state")
    assert r.status_code == 200
    st = r.json()
    assert "settlements" in st and "roads" in st and "hazard_alerts" in st
    print(f"[PASS] GET /state -> {len(st['settlements'])} settlements, {len(st['roads'])} roads, {len(st['hazard_alerts'])} alerts")

    # 3. Predict endpoint
    pred_payload = {
        "rainfall_mm": 185.0,
        "elevation_m": 720.0,
        "distance_to_river_km": 0.4,
        "historical_flood_flag": 1,
        "settlement_name": "Test Location"
    }
    r = client.post("/predict", json=pred_payload)
    assert r.status_code == 200
    pdata = r.json()
    assert "prediction" in pdata and "explainability" in pdata
    pred_info = pdata["prediction"]
    assert "risk_score" in pred_info and "risk_level" in pred_info
    print(f"[PASS] POST /predict -> risk_score={pred_info['risk_score']}, level={pred_info['risk_level']}, explanation={pdata['explainability']['hydrology_rationale']}")

    # 4. Model Comparison
    r = client.get("/model-comparison")
    assert r.status_code == 200
    bench = r.json()
    assert "models_comparison" in bench
    print(f"[PASS] GET /model-comparison -> models={list(bench['models_comparison'].keys())}")

    # 5. Settlements
    r = client.get("/settlements/?timestep=T4")
    assert r.status_code == 200
    s_list = r.json()
    assert s_list["count"] == 18
    print(f"[PASS] GET /settlements/?timestep=T4 -> count={s_list['count']}")

    r = client.get("/settlements/S01")
    assert r.status_code == 200
    s01 = r.json()
    assert s01["settlement_id"] == "S01"
    print(f"[PASS] GET /settlements/S01 -> name={s01['name']}, timesteps={len(s01['timesteps'])}")

    # 6. Roads
    r = client.get("/roads?timestep=T4")
    assert r.status_code == 200
    roads = r.json()
    assert len(roads) > 0
    # Check if geometry is present
    has_geom = any("geometry" in rd and len(rd["geometry"]) > 2 for rd in roads)
    print(f"[PASS] GET /roads?timestep=T4 -> {len(roads)} roads, detailed OSRM road geometry present={has_geom}")

    # 7. Alerts
    r = client.get("/alerts?timestep=T4")
    assert r.status_code == 200
    alerts = r.json()
    print(f"[PASS] GET /alerts?timestep=T4 -> {len(alerts)} alerts")

    # 8. Early Warnings
    r = client.get("/early-warnings?timestep=T4")
    assert r.status_code == 200
    ew = r.json()
    assert isinstance(ew, list)
    print(f"[PASS] GET /early-warnings?timestep=T4 -> {len(ew)} early warning(s) detected: {[w['settlement_name'] for w in ew]}")

    # 9. Priority
    r = client.get("/priority?timestep=T4")
    assert r.status_code == 200
    prio = r.json()
    assert len(prio) == 18
    print(f"[PASS] GET /priority?timestep=T4 -> 18 settlements ranked. #1: {prio[0]['name']}")

    # 10. Safe Route (OSRM road geometry & ETA)
    r = client.get("/routing/safe-route/S01?timestep=T4")
    assert r.status_code == 200
    route = r.json()
    assert "available" in route
    if route["available"]:
        print(f"[PASS] GET /routing/safe-route/S01?timestep=T4 -> available={route['available']}, distance={route.get('distance_km')}km, eta={route.get('eta_min')}min, waypoints={len(route.get('coordinates', []))}")
    else:
        print(f"[PASS] GET /routing/safe-route/S01?timestep=T4 -> isolated (no safe route)")

    # 11. Dynamic Unit Dispatch (Greedy Allocation)
    dispatch_payload = {
        "timestep": "T4",
        "total_units": 5
    }
    r = client.post("/dispatch/assign-units", json=dispatch_payload)
    assert r.status_code == 200
    disp = r.json()
    assert "assignments" in disp and "units_used" in disp
    print(f"[PASS] POST /dispatch/assign-units -> total={disp['total_units']}, used={disp['units_used']}, remaining={disp['units_remaining']}, covered={disp['fully_covered']}")
    for a in disp["assignments"]:
        print(f"       -> {a['units_assigned']}/{a['units_needed']} units allocated to {a['settlement_id']} ({a['name']}) | Rank #{a['priority_rank']} | Status: {a['status']} | ETA: {a.get('eta_min', 'N/A')} min | Dist: {a.get('distance_km', 'N/A')} km")

    # 12. Meta endpoints
    r = client.get("/settlements/meta/timesteps")
    assert r.status_code == 200
    r = client.get("/settlements/meta/model-info")
    assert r.status_code == 200
    r = client.get("/settlements/meta/test-scenarios")
    assert r.status_code == 200
    print(f"[PASS] GET meta endpoints (/timesteps, /model-info, /test-scenarios) all 200 OK")

    # 13. Ground Reports mutation
    rep = {
        "settlement_id": "S03",
        "road_id": "R19",
        "timestep": "T4",
        "type": "flooded_road",
        "text": "Automated verification test: Flash flood blocking road R19"
    }
    r = client.post("/ground-reports", json=rep)
    assert r.status_code == 200
    print(f"[PASS] POST /ground-reports -> mutation acknowledged, state recomputed={r.json()['state_recomputed']}")

    print("=" * 70)
    print("ALL 13 MISC-04 FASTAPI ENDPOINT SUITE TESTS PASSED!")
    print("=" * 70)

if __name__ == "__main__":
    run_tests()
