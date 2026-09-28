"""
MISC-04 — Coordination Layer Pipeline (Member B)
End-to-end data processing:
  1. Load Member A's model output
  2. Ground report activation & risk score boosting
  3. Road network graph creation & status evaluation
  4. Accessibility & multi-factor priority ranking
  5. Evidence-carrying hazard alerts
  6. Dynamic Dijkstra safe-route computation
  7. System validation & test scenario enrichment
  8. Full appState assembly & in-memory caching
"""

import json
import math
from pathlib import Path
import networkx as nx
import pandas as pd
from services.config import *

DATA = Path(__file__).resolve().parent.parent / "data"

def level_from_score(s: float) -> str:
    return "low" if s <= LOW_MAX else ("medium" if s <= HIGH_MIN else "high")

def haversine_km(a, b):
    R = 6371.0
    la1, lo1, la2, lo2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    d = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(d))

# ---------- 1. Load Member A's data into per-settlement dicts ----------
def load_settlements():
    df = pd.read_pickle(DATA / "processed_settlements.pkl")
    S = {}
    for sid, g in df.groupby("settlement_id", sort=True):
        g = g.set_index("timestep").loc[TIMESTEPS]  # KeyError if a timestep is missing = good
        f = g.iloc[0]
        S[sid] = {
            "id": sid,
            "name": f["name"],
            "taluk": f["taluk"],
            "lat": float(f["lat"]),
            "lng": float(f["lng"]),
            "population": int(f["population"]),
            "elevation_m": float(f["elevation_m"]),
            "distance_to_river_km": float(f["distance_to_river_km"]),
            "historical_flood_flag": int(f["historical_flood_flag"]),
            "rainfall_mm": {t: float(g.loc[t, "rainfall_mm"]) for t in TIMESTEPS},
            "model_risk_score": {t: float(g.loc[t, "risk_score"]) for t in TIMESTEPS},
        }
    return S

# ---------- 2. Ground reports ----------
def activate(rep):
    rep_copy = dict(rep)
    i = TIMESTEPS.index(rep_copy["timestep"])
    rep_copy["active_timesteps"] = TIMESTEPS[i:i + REPORT_ACTIVE_STEPS]
    return rep_copy

def load_seed_reports():
    seed_path = DATA / "ground_reports_seed.json"
    if not seed_path.exists():
        return []
    with open(seed_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return [activate(r) for r in data]

# ---------- 3. Road graph ----------
def build_roads(S):
    name2id = {s["name"]: sid for sid, s in S.items()}
    roads = []
    roads_seed_path = DATA / "roads_seed.json"
    with open(roads_seed_path, "r", encoding="utf-8") as f:
        pairs = json.load(f)

    for i, (a, b) in enumerate(pairs, 1):
        if a not in name2id or b not in name2id:
            print(f"[roads] skipped {a}-{b}: not in dataset")
            continue
        A, B = S[name2id[a]], S[name2id[b]]
        roads.append({
            "id": f"R{i:02d}",
            "from": A["id"],
            "to": B["id"],
            "from_name": a,
            "to_name": b,
            "length_km": round(haversine_km((A["lat"], A["lng"]), (B["lat"], B["lng"])), 2),
            "coordinates": [[A["lat"], A["lng"]], [B["lat"], B["lng"]]],
            "geometry_note": "approximate straight line between settlement centroids"
        })
    return roads

# ---------- 4. Apply ground reports to risk (final risk used everywhere downstream) ----------
def apply_reports(S, reports):
    for s in S.values():
        for k in ("report_boost", "risk_score", "risk_level", "confidence", "model_risk_level"):
            s[k] = {}
        for t in TIMESTEPS:
            boost = min(REPORT_BOOST_CAP, sum(
                REPORT_BOOST[r["type"]] for r in reports
                if r["settlement_id"] == s["id"] and t in r["active_timesteps"]
            ))
            m = s["model_risk_score"][t]
            f = min(1.0, m + boost)
            s["report_boost"][t] = round(boost, 3)
            s["risk_score"][t] = round(f, 4)
            s["risk_level"][t] = level_from_score(f)
            s["model_risk_level"][t] = level_from_score(m)
            s["confidence"][t] = round(abs(f - 0.5) * 2, 4)

# ---------- 5. Road status ----------
def apply_road_status(S, roads, reports):
    for r in roads:
        r["status"], r["closure_reason"] = {}, {}
        for t in TIMESTEPS:
            mean = (S[r["from"]]["risk_score"][t] + S[r["to"]]["risk_score"][t]) / 2
            rep = next((x for x in reports if x["type"] == "flooded_road"
                        and x.get("road_id") == r["id"] and t in x["active_timesteps"]), None)
            if rep:
                r["status"][t] = "closed"
                r["closure_reason"][t] = f"Ground report {rep['id']}: flooded road"
            elif mean >= ROAD_CLOSE_MEAN_RISK:
                r["status"][t] = "closed"
                r["closure_reason"][t] = f"Combined endpoint risk {mean:.2f} >= {ROAD_CLOSE_MEAN_RISK}"
            else:
                r["status"][t] = "open"
                r["closure_reason"][t] = None

# ---------- 6. Accessibility + priority ranking ----------
def apply_priority(S, roads):
    pops = [s["population"] for s in S.values()]
    lo, hi = min(pops), max(pops)
    for sid, s in S.items():
        inc = [r for r in roads if sid in (r["from"], r["to"])]
        s["road_accessibility"], s["priority_score"], s["priority_rank"] = {}, {}, {}
        for t in TIMESTEPS:
            acc = sum(r["status"][t] == "open" for r in inc) / len(inc) if inc else 0.0
            pop_n = (s["population"] - lo) / (hi - lo + 1e-9)
            s["road_accessibility"][t] = round(acc, 3)
            s["priority_score"][t] = round(W_RISK * s["risk_score"][t] + W_POP * pop_n + W_ISO * (1.0 - acc), 4)

    for t in TIMESTEPS:
        order = sorted(S.values(), key=lambda s: (-s["priority_score"][t], -s["risk_score"][t], s["name"]))
        for rank, s in enumerate(order, 1):
            s["priority_rank"][t] = rank

# ---------- 7. Alerts (only HIGH; never an empty evidence block) ----------
def build_alerts(S, roads, reports):
    alerts = []
    for t in TIMESTEPS:
        for s in S.values():
            if s["risk_level"][t] != "high":
                continue
            inc = [r for r in roads if s["id"] in (r["from"], r["to"])]
            closed = sum(r["status"][t] == "closed" for r in inc)
            reps = [r for r in reports if r["settlement_id"] == s["id"] and t in r["active_timesteps"]]
            alerts.append({
                "id": f"A-{t}-{s['id']}",
                "settlement_id": s["id"],
                "settlement_name": s["name"],
                "timestep": t,
                "risk_level": "high",
                "risk_score": s["risk_score"][t],
                "confidence": s["confidence"][t],
                "priority_rank": s["priority_rank"][t],
                "evidence": {
                    "rainfall_mm": s["rainfall_mm"][t],
                    "elevation_m": s["elevation_m"],
                    "distance_to_river_km": s["distance_to_river_km"],
                    "ground_reports_nearby": len(reps),  # active reports AT this settlement
                    "model_risk_score": round(s["model_risk_score"][t], 4),
                    "report_boost": s["report_boost"][t],
                    "roads_closed": closed,
                    "roads_total": len(inc),
                    "historical_flood_flag": s["historical_flood_flag"]
                },
                "label": (
                    f"High flood risk — {s['name']}: {s['rainfall_mm'][t]:.0f} mm rain, "
                    f"{s['elevation_m']:.0f} m elevation, {closed}/{len(inc)} roads closed"
                    + (f", {len(reps)} ground report(s)" if reps else "")
                )
            })
    alerts.sort(key=lambda a: (TIMESTEPS.index(a["timestep"]), a["priority_rank"]))
    return alerts

# ---------- 8. Safe routes: precomputed for every non-low settlement x timestep ----------
def build_safe_routes(S, roads):
    out = {}
    for t in TIMESTEPS:
        H = nx.Graph()
        H.add_nodes_from(S.keys())
        for r in roads:
            if r["status"][t] == "open":
                H.add_edge(r["from"], r["to"], weight=r["length_km"], road_id=r["id"])

        low = {sid for sid, s in S.items() if s["risk_level"][t] == "low"}
        for sid, s in S.items():
            if sid in low:
                continue  # already safe: no entry (frontend: not applicable)
            dist, paths = nx.single_source_dijkstra(H, sid, weight="weight")
            cands = [(dist[x], x) for x in low if x in dist]
            if not cands:
                out.setdefault(sid, {})[t] = None  # null = genuinely no open route (show honestly)
                continue
            d, target = min(cands)
            p = paths[target]
            out.setdefault(sid, {})[t] = {
                "path": p,
                "target_id": target,
                "target_name": S[target]["name"],
                "distance_km": round(d, 2),
                "road_ids": [H[u][v]["road_id"] for u, v in zip(p, p[1:])],
                "coordinates": [[S[n]["lat"], S[n]["lng"]] for n in p]
            }
    return out

# ---------- 9. Validation + enriched test scenarios ----------
def validate_routes(S, roads, safe_routes):
    open_edges = {t: {frozenset((r["from"], r["to"])) for r in roads if r["status"][t] == "open"} for t in TIMESTEPS}
    checked = bad = 0
    for sid, by_t in safe_routes.items():
        for t, route in by_t.items():
            if route is None:
                continue
            checked += 1
            p = route["path"]
            ok = S[p[-1]]["risk_level"][t] == "low" and all(frozenset(e) in open_edges[t] for e in zip(p, p[1:]))
            bad += (not ok)
    return checked, bad

def false_alert_audit(S, alerts):
    q75 = lambda xs: sorted(xs)[int(0.75 * (len(xs) - 1))]
    e75 = q75([s["elevation_m"] for s in S.values()])
    d75 = q75([s["distance_to_river_km"] for s in S.values()])
    sus = [a for a in alerts if S[a["settlement_id"]]["elevation_m"] >= e75
           and S[a["settlement_id"]]["distance_to_river_km"] >= d75]
    return {
        "alerts_total": len(alerts),
        "implausible_alerts": len(sus),
        "proxy_false_alert_rate": round(len(sus) / len(alerts), 3) if alerts else 0.0,
        "note": "Proxy audit: alerts on high-elevation, far-from-river settlements. Not measured against verified ground truth."
    }

def build_tests(S, roads, safe_routes, alerts):
    with open(DATA / "test_scenarios.json", "r", encoding="utf-8") as f:
        tests = json.load(f)

    fa = tests["false_alert_case"]
    fa["final_level_after_reports"] = S[fa["settlement_id"]]["risk_level"][fa["timestep"]]
    fa["passed"] = bool(fa.get("passed", True) and fa["final_level_after_reports"] != "high")

    d = tests["route_disruption_case"]
    sid, t = d["settlement_id"], d["timestep"]
    inc = [r for r in roads if sid in (r["from"], r["to"])]
    d["roads_closed_at_timestep"] = [r["id"] for r in inc if r["status"][t] == "closed"]
    d["roads_total"] = len(inc)
    d["safe_route"] = safe_routes.get(sid, {}).get(t)
    checked, bad = validate_routes(S, roads, safe_routes)
    d["route_valid"] = (bad == 0)
    d["passed"] = bool(d.get("passed", True) and bad == 0)

    # Ensure frontend compatibility fields for validation screen
    fa["input_conditions"]["settlement"] = f"{S[fa['settlement_id']]['name']} ({fa['settlement_id']})"
    fa["input_conditions"]["timestep"] = f"{fa['timestep']} (Receding/Late event)"
    d["input_conditions"]["affected_node"] = f"{S[sid]['name']} ({sid})"
    d["input_conditions"]["risk_level_at_T5"] = S[sid]["risk_level"].get("T5", "high")
    d["input_conditions"]["ground_reports"] = "Severe flash runoff & river bank surge"
    d["input_conditions"]["target_roads"] = [f"{r['id']} ({r['from_name']} - {r['to_name']})" for r in inc]
    if "model_output" not in d:
        d["model_output"] = {}
    d["model_output"]["reroute_path_found"] = " → ".join([S[node]["name"] for node in d["safe_route"]["path"]]) if d.get("safe_route") else "No open route (isolated)"

    influence = [
        {
            "settlement_id": s["id"],
            "name": s["name"],
            "timestep": t,
            "model_level": s["model_risk_level"][t],
            "final_level": s["risk_level"][t]
        }
        for s in S.values() for t in TIMESTEPS if s["model_risk_level"][t] != s["risk_level"][t]
    ]

    tests["system_checks"] = {
        "route_validity": {
            "routes_checked": checked,
            "invalid": bad,
            "rate": round(1 - bad / checked, 3) if checked else 1.0
        },
        "false_alert_audit": false_alert_audit(S, alerts),
        "report_influence": influence
    }
    return tests

# ---------- 10. Assemble the full appState ----------
def build_state(reports):
    S = load_settlements()
    apply_reports(S, reports)
    roads = build_roads(S)
    apply_road_status(S, roads, reports)
    apply_priority(S, roads)
    alerts = build_alerts(S, roads, reports)
    safe = build_safe_routes(S, roads)
    tests = build_tests(S, roads, safe, alerts)
    summary = {
        t: {
            "high": sum(s["risk_level"][t] == "high" for s in S.values()),
            "medium": sum(s["risk_level"][t] == "medium" for s in S.values()),
            "low": sum(s["risk_level"][t] == "low" for s in S.values()),
            "roads_closed": sum(r["status"][t] == "closed" for r in roads),
            "roads_total": len(roads),
            "active_reports": sum(t in r["active_timesteps"] for r in reports)
        }
        for t in TIMESTEPS
    }

    with open(DATA / "feature_importances.json", "r", encoding="utf-8") as f:
        trained_feat_imp = json.load(f)

    timestep_labels = {
        "T1": "Aug 08 06:00 (Onset)",
        "T2": "Aug 08 12:00 (Escalating)",
        "T3": "Aug 08 18:00 (Heavy Inflow)",
        "T4": "Aug 09 00:00 (Surge Point)",
        "T5": "Aug 09 06:00 (Peak Flood 305mm)",
        "T6": "Aug 09 12:00 (Sustained Inundation)",
        "T7": "Aug 09 18:00 (Receding Inflow)",
        "T8": "Aug 10 00:00 (Post-Peak Response)"
    }

    return {
        "district": "Wayanad",
        "hazard_type": "flood",
        "data_label": "REPLAYED — August 2018 Wayanad flood event (IMD/CWC records)",
        "timesteps": TIMESTEPS,
        "timestep_labels": timestep_labels,
        "current_timestep_index": 0,
        "settlements": sorted(S.values(), key=lambda s: s["id"]),
        "roads": roads,
        "ground_reports": reports,
        "hazard_alerts": alerts,
        "safe_routes": safe,
        "test_scenarios": tests,
        "summary_by_timestep": summary,
        "feature_importances": {
            "rainfall": round(trained_feat_imp.get("rainfall_mm", 0.35), 4),
            "elevation": round(trained_feat_imp.get("elevation_m", 0.30), 4),
            "distance_to_river": round(trained_feat_imp.get("distance_to_river_km", 0.20), 4),
            "historical_flood": round(trained_feat_imp.get("historical_flood_flag", 0.15), 4)
        },
        "model_info": {
            "trained_feature_importances": trained_feat_imp,
            "literature_weights": LITERATURE_WEIGHTS
        },
        "meta": {
            "ranking_formula": {"risk": W_RISK, "population": W_POP, "isolation": W_ISO},
            "road_closure_rule": f"closed if mean endpoint risk >= {ROAD_CLOSE_MEAN_RISK} or an active flooded-road report",
            "report_boost": REPORT_BOOST,
            "report_boost_cap": REPORT_BOOST_CAP,
            "risk_thresholds": {"low_max": LOW_MAX, "high_min": HIGH_MIN},
            "road_geometry": "approximate straight lines between settlement centroids",
            "ground_reports": "simulated"
        }
    }

# ---------- 11. In-memory cache (recomputed when a report is POSTed) ----------
_reports, _state = None, None

def get_state():
    global _reports, _state
    if _state is None:
        _reports = load_seed_reports()
        _state = build_state(_reports)
    return _state

def add_report(data):
    global _reports, _state
    get_state()
    rep = activate({**data, "id": f"G{len(_reports) + 1:02d}", "is_simulated": True})
    _reports.append(rep)
    _state = build_state(_reports)
    return rep
