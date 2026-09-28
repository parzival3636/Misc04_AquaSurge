"""
MISC-04 — Alerts & Priority Router (Member B)
Endpoints:
  GET /alerts?timestep=T1    → Ranked high-risk hazard alerts with evidence blocks
  GET /priority?timestep=T1  → Settlement priority ranking list for emergency teams
"""

from fastapi import APIRouter, HTTPException
from services.pipeline import get_state

router = APIRouter(tags=["alerts"])

@router.get("/alerts")
def get_alerts(timestep: str = "T1"):
    st = get_state()
    if timestep not in st["timesteps"]:
        raise HTTPException(400, f"Invalid timestep '{timestep}'. Must be one of {st['timesteps']}")
    return [a for a in st["hazard_alerts"] if a["timestep"] == timestep]

@router.get("/priority")
def get_priority(timestep: str = "T1"):
    st = get_state()
    if timestep not in st["timesteps"]:
        raise HTTPException(400, f"Invalid timestep '{timestep}'. Must be one of {st['timesteps']}")
    rows = [
        {
            "id": s["id"],
            "name": s["name"],
            "priority_rank": s["priority_rank"][timestep],
            "priority_score": s["priority_score"][timestep],
            "risk_level": s["risk_level"][timestep],
            "road_accessibility": s["road_accessibility"][timestep]
        }
        for s in st["settlements"]
    ]
    return sorted(rows, key=lambda r: r["priority_rank"])
