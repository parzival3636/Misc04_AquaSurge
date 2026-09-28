"""
MISC-04 — Settlements Router (Member A)
All settlement-related API endpoints.

Endpoints:
  GET /settlements?timestep=T1         → list all settlements for a timestep
  GET /settlements/{settlement_id}     → all timesteps for one settlement
  GET /settlements/meta/timesteps      → district metadata + timestep list
  GET /settlements/meta/model-info     → trained vs literature feature importances
  GET /settlements/meta/test-scenarios → false-alert + route-disruption test results
"""

from fastapi import APIRouter, HTTPException
import pandas as pd
import joblib
import json
import os

router = APIRouter(prefix="/settlements", tags=["settlements"])

# Resolve paths relative to this file's location
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")

# Load model and data at startup
try:
    model = joblib.load(os.path.join(DATA_DIR, "model.pkl"))
    df = pd.read_pickle(os.path.join(DATA_DIR, "processed_settlements.pkl"))
    print(f"[OK] Loaded model and {len(df)} data rows from data/")
except FileNotFoundError as e:
    raise RuntimeError(
        f"Data files not found! Run 'python build_data.py' first.\n"
        f"Missing: {e}"
    )


@router.get("/")
def list_settlements(timestep: str = "T1"):
    """List all settlements with their risk data for a given timestep."""
    valid_timesteps = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"]
    if timestep not in valid_timesteps:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid timestep '{timestep}'. Must be one of {valid_timesteps}"
        )
    
    subset = df[df.timestep == timestep].copy()
    # Convert risk_level from categorical to string for JSON serialization
    subset["risk_level"] = subset["risk_level"].astype(str)
    records = subset.to_dict(orient="records")
    
    # Round floats for cleaner API output
    for r in records:
        r["risk_score"] = round(r["risk_score"], 3)
        r["confidence"] = round(r["confidence"], 3)
    
    return {
        "timestep": timestep,
        "count": len(records),
        "settlements": records
    }


@router.get("/meta/timesteps")
def get_timesteps():
    """Return district metadata and timestep definitions."""
    return {
        "district": "Wayanad",
        "state": "Kerala",
        "hazard_type": "flood",
        "data_label": "REPLAYED — August 2018 Wayanad flood event (IMD/CWC records)",
        "timesteps": ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"],
        "timestep_labels": {
            "T1": "Aug 08 06:00 (Onset)",
            "T2": "Aug 08 12:00 (Escalating)",
            "T3": "Aug 08 18:00 (Heavy Inflow)",
            "T4": "Aug 09 00:00 (Surge Point)",
            "T5": "Aug 09 06:00 (Peak Flood 305mm)",
            "T6": "Aug 09 12:00 (Sustained Inundation)",
            "T7": "Aug 09 18:00 (Receding Inflow)",
            "T8": "Aug 10 00:00 (Post-Peak Response)"
        }
    }


@router.get("/meta/model-info")
def model_info():
    """Return trained feature importances vs literature weights."""
    imp_path = os.path.join(DATA_DIR, "feature_importances.json")
    try:
        with open(imp_path, encoding="utf-8") as f:
            importances = json.load(f)
    except FileNotFoundError:
        importances = {"error": "feature_importances.json not found"}
    
    return {
        "model_type": "RandomForestClassifier",
        "n_estimators": 100,
        "max_depth": 5,
        "trained_feature_importances": importances,
        "literature_weights": {
            "rainfall_mm": 0.35,
            "elevation_m": 0.30,
            "distance_to_river_km": 0.20,
            "historical_flood_flag": 0.15
        },
        "training_data": {
            "total_rows": len(df),
            "settlements": df["settlement_id"].nunique(),
            "timesteps": 8
        }
    }


@router.get("/meta/test-scenarios")
def test_scenarios():
    """Return the two validation test case results."""
    test_path = os.path.join(DATA_DIR, "test_scenarios.json")
    try:
        with open(test_path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="test_scenarios.json not found. Run build_data.py first."
        )


@router.get("/{settlement_id}")
def get_settlement(settlement_id: str):
    """Get all timestep data for a specific settlement."""
    rows = df[df.settlement_id == settlement_id.upper()].copy()
    if rows.empty:
        raise HTTPException(
            status_code=404,
            detail=f"Settlement '{settlement_id}' not found"
        )
    
    rows["risk_level"] = rows["risk_level"].astype(str)
    records = rows.to_dict(orient="records")
    for r in records:
        r["risk_score"] = round(r["risk_score"], 3)
        r["confidence"] = round(r["confidence"], 3)
    
    return {
        "settlement_id": settlement_id.upper(),
        "name": records[0]["name"],
        "taluk": records[0]["taluk"],
        "lat": records[0]["lat"],
        "lng": records[0]["lng"],
        "population": records[0]["population"],
        "timesteps": records
    }
