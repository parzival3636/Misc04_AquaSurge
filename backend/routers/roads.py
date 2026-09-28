"""
MISC-04 — Roads Router (Member B)
Endpoint:
  GET /roads?timestep=T1  → Road segments with dynamic status and closure reason
"""

from fastapi import APIRouter, HTTPException
from services.pipeline import get_state

router = APIRouter(prefix="/roads", tags=["roads"])

@router.get("/")
def get_roads(timestep: str = "T1"):
    st = get_state()
    if timestep not in st["timesteps"]:
        raise HTTPException(400, f"Invalid timestep '{timestep}'. Must be one of {st['timesteps']}")
    return [
        {
            **{k: r[k] for k in ("id", "from", "to", "from_name", "to_name", "length_km", "coordinates")},
            "status": r["status"][timestep],
            "closure_reason": r["closure_reason"][timestep]
        }
        for r in st["roads"]
    ]
