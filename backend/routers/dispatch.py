"""
MISC-04 — Dynamic Rescue Unit Dispatch Router (Part 3)
Endpoints:
  POST /dispatch/assign-units  → Greedy unit allocation by priority rank order
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from services.pipeline import assign_units, get_state

router = APIRouter(prefix="/dispatch", tags=["dispatch"])


class UnitAssignRequest(BaseModel):
    total_units: int
    timestep: str


@router.post("/assign-units")
def dispatch_units(body: UnitAssignRequest):
    """
    Allocate rescue units to at-risk settlements using a greedy algorithm.
    Units are assigned in priority rank order (highest priority first).
    Each settlement's unit need is computed from population band + risk band.
    Returns full assignment details including real road distance/ETA from depot.
    """
    st = get_state()
    if body.timestep not in st["timesteps"]:
        raise HTTPException(400, f"Invalid timestep '{body.timestep}'. Must be one of {st['timesteps']}")
    if body.total_units < 0:
        raise HTTPException(400, "total_units must be non-negative")
    return assign_units(body.total_units, body.timestep, st)
