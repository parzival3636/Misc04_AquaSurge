"""
MISC-04 — State Router (Member B)
Endpoints:
  GET  /state           → Full nested appState matching frontend schema
  GET  /ground-reports  → List of active/seed ground reports
  POST /ground-reports  → Dynamically inject citizen ground report & recompute state live
"""

from typing import Literal, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from services.pipeline import get_state, add_report
from services.config import TIMESTEPS

router = APIRouter(tags=["state"])

class ReportIn(BaseModel):
    settlement_id: str
    road_id: Optional[str] = None
    timestep: Literal["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"]
    type: Literal["flooded_road", "stranded_people", "other"]
    text: str

@router.get("/state")
def state():
    """Returns complete coordination platform state in nested appState format."""
    return get_state()

@router.get("/ground-reports")
def reports():
    """Returns all current ground reports."""
    return get_state()["ground_reports"]

@router.post("/ground-reports")
def post_report(body: ReportIn):
    """Submits a new citizen report, triggering immediate state re-computation."""
    st = get_state()
    if body.settlement_id not in {s["id"] for s in st["settlements"]}:
        raise HTTPException(404, f"Unknown settlement_id '{body.settlement_id}'")
    if body.road_id and body.road_id not in {r["id"] for r in st["roads"]}:
        raise HTTPException(404, f"Unknown road_id '{body.road_id}'")
    rep = add_report(body.model_dump() if hasattr(body, "model_dump") else body.dict())
    return {"ok": True, "state_recomputed": True, "report": rep}
