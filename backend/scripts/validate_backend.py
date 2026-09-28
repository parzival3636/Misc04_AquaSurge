"""
MISC-04 — Coordination Layer Validation Script (Member B)
Validates all 8 acceptance criteria:
  1. Every settlement has all 8 timesteps, no NaN anywhere
  2. Road graph is connected at T1
  3. Priority ranks are unique 1..N at every timestep
  4. Alerts have non-empty evidence blocks and match high-risk settlements
  5. Safe routes use only open roads and end at low-risk settlements
  6. Ground report influence is real (at least 2 entries)
  7. Mutation test: presence of reports demonstrably changes state
  8. Road status progression (open->closed) and alert escalation between T1 and T8

Run: python -m scripts.validate_backend (from inside backend/)
"""

import sys
import json
import networkx as nx
from services.pipeline import get_state, build_state, load_seed_reports, validate_routes
from services.config import TIMESTEPS

def run_validations():
    print("=" * 70)
    print("MISC-04 COORDINATION LAYER BACKEND ACCEPTANCE CHECKS")
    print("=" * 70)

    st = get_state()
    all_passed = True

    # Check 1: 8 timesteps, no NaN, JSON serializable
    c1_ok = True
    try:
        json_str = json.dumps(st, allow_nan=False)
        for s in st["settlements"]:
            for field in ("risk_score", "risk_level", "priority_rank", "rainfall_mm", "confidence"):
                if len(s[field]) != 8 or any(t not in s[field] for t in TIMESTEPS):
                    c1_ok = False
                    break
    except Exception as e:
        c1_ok = False
        print(f"  [ERROR] Serialization error: {e}")

    if c1_ok:
        print("[PASS] Check 1: All settlements contain all 8 timesteps with zero NaN values (valid JSON).")
    else:
        print("[FAIL] Check 1: Missing timesteps or NaN found in settlements data.")
        all_passed = False

    # Check 2: Road graph connectivity at T1
    H_t1 = nx.Graph()
    H_t1.add_nodes_from([s["id"] for s in st["settlements"]])
    for r in st["roads"]:
        if r["status"]["T1"] == "open":
            H_t1.add_edge(r["from"], r["to"])

    c2_ok = nx.is_connected(H_t1)
    if c2_ok:
        print(f"[PASS] Check 2: Road network open subgraph is fully connected at T1 ({H_t1.number_of_nodes()} nodes, {H_t1.number_of_edges()} open edges).")
    else:
        print(f"[FAIL] Check 2: Road network at T1 is disconnected ({nx.number_connected_components(H_t1)} components).")
        all_passed = False

    # Check 3: Priority ranks unique 1..N at every timestep
    c3_ok = True
    N = len(st["settlements"])
    for t in TIMESTEPS:
        ranks = [s["priority_rank"][t] for s in st["settlements"]]
        if sorted(ranks) != list(range(1, N + 1)):
            c3_ok = False
            break

    if c3_ok:
        print(f"[PASS] Check 3: Priority ranks are uniquely and strictly distributed 1..{N} across all 8 timesteps.")
    else:
        print("[FAIL] Check 3: Priority ranks contain duplicates or gaps.")
        all_passed = False

    # Check 4: Non-empty evidence blocks & high risk alignment
    c4_ok = True
    s_map = {s["id"]: s for s in st["settlements"]}
    alerts = st["hazard_alerts"]
    for a in alerts:
        ev = a.get("evidence", {})
        if not ev or s_map[a["settlement_id"]]["risk_level"][a["timestep"]] != "high":
            c4_ok = False
            break

    if c4_ok and len(alerts) > 0:
        print(f"[PASS] Check 4: All {len(alerts)} alerts carry non-empty evidence blocks and strictly target high-risk settlements.")
    else:
        print("[FAIL] Check 4: Some alerts have empty evidence or target non-high settlements.")
        all_passed = False

    # Check 5: Safe routes validity (open edges only, terminates at low-risk)
    checked, bad = validate_routes(s_map, st["roads"], st["safe_routes"])
    c5_ok = (bad == 0 and checked > 0)
    if c5_ok:
        print(f"[PASS] Check 5: Logical consistency of safe routes verified ({checked} routes checked, 0 invalid paths).")
    else:
        print(f"[FAIL] Check 5: Found {bad} invalid safe routes among {checked} routes checked.")
        all_passed = False

    # Check 6: Report influence is real (at least 2 entries)
    influence = st["test_scenarios"]["system_checks"]["report_influence"]
    c6_ok = len(influence) >= 2
    if c6_ok:
        print(f"[PASS] Check 6: Ground report influence verified ({len(influence)} risk-level flips recorded).")
        for inf in influence:
            print(f"       -> {inf['name']} at {inf['timestep']}: {inf['model_level']} -> {inf['final_level']}")
    else:
        print(f"[FAIL] Check 6: Insufficient report influence ({len(influence)} entries, expected >= 2).")
        all_passed = False

    # Check 7: Mutation test
    st_empty = build_state([])
    st_seed = build_state(load_seed_reports())
    settlement_diffs = [
        (s["id"], t)
        for s, s2 in zip(st_empty["settlements"], st_seed["settlements"])
        for t in TIMESTEPS if s["risk_level"][t] != s2["risk_level"][t]
    ]
    road_diffs = [
        (r["id"], t)
        for r, r2 in zip(st_empty["roads"], st_seed["roads"])
        for t in TIMESTEPS if r["status"][t] != r2["status"][t]
    ]
    c7_ok = (len(settlement_diffs) > 0 or len(road_diffs) > 0)
    if c7_ok:
        print(f"[PASS] Check 7: Mutation test confirmed (reports altered {len(settlement_diffs)} settlement risk evaluations and {len(road_diffs)} road statuses).")
    else:
        print("[FAIL] Check 7: Mutation test failed: reports had zero observable effect on settlements or roads.")
        all_passed = False

    # Check 8: Road flipping open->closed and alert escalation T1->T8
    roads_flipped = [
        r["id"] for r in st["roads"]
        if r["status"]["T1"] == "open" and r["status"]["T8"] == "closed"
    ]
    alerts_t1 = sum(1 for a in st["hazard_alerts"] if a["timestep"] == "T1")
    alerts_t8 = sum(1 for a in st["hazard_alerts"] if a["timestep"] == "T8")
    c8_ok = (len(roads_flipped) > 0 and alerts_t8 > alerts_t1)
    if c8_ok:
        print(f"[PASS] Check 8: Event progression verified ({len(roads_flipped)} roads closed between T1 and T8; alerts escalated from {alerts_t1} at T1 to {alerts_t8} at T8).")
    else:
        print(f"[FAIL] Check 8: Progression check failed (roads flipped: {len(roads_flipped)}, alerts T1: {alerts_t1}, T8: {alerts_t8}).")
        all_passed = False

    print("=" * 70)
    if all_passed:
        print("RESULT: ALL 8 ACCEPTANCE CRITERIA PASSED SUCCESSFULLY.")
        print("=" * 70)
        return 0
    else:
        print("RESULT: SOME ACCEPTANCE CRITERIA FAILED.")
        print("=" * 70)
        return 1

if __name__ == "__main__":
    sys.exit(run_validations())
