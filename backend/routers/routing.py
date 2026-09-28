"""
MISC-04 — Safe Routing Router (Member B)
Endpoint:
  GET /routing/safe-route/{settlement_id}?timestep=T1 → Dynamic shortest path to nearest low-risk node
"""

from fastapi import APIRouter, HTTPException
from services.pipeline import get_state

router = APIRouter(prefix="/routing", tags=["routing"])

@router.get("/safe-route/{settlement_id}")
def safe_route(settlement_id: str, timestep: str = "T1"):
    st = get_state()
    if settlement_id not in {s["id"] for s in st["settlements"]}:
        raise HTTPException(404, f"Unknown settlement_id '{settlement_id}'")
    if timestep not in st["timesteps"]:
        raise HTTPException(400, f"Invalid timestep '{timestep}'. Must be one of {st['timesteps']}")

    by_t = st["safe_routes"].get(settlement_id, {})
    if timestep not in by_t:
        return {"available": False, "reason": "Settlement is currently low risk, no evacuation route needed"}
    route = by_t[timestep]
    if route is None:
        return {"available": False, "reason": "No open route currently available"}
    return {
        "available": True,
        "label": "Heuristic shortest path, not an official evacuation route",
        **route
    }
