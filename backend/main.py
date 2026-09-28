"""
MISC-04 — Member A: FastAPI Backend
Main application entry point.

Run:  uvicorn main:app --reload --port 8000   (from inside backend/)
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import settlements

app = FastAPI(
    title="MISC-04 Coordination API",
    description="Local Disaster Warning & Response Coordination Platform — Wayanad 2018 Flood Replay",
    version="1.0.0"
)

# CORS — allow all origins for hackathon frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from routers import settlements, roads, alerts, routing, state, predict

app.include_router(settlements.router)
app.include_router(roads.router)
app.include_router(alerts.router)
app.include_router(routing.router)
app.include_router(state.router)
app.include_router(predict.router)

@app.get("/")
def root():
    return {
        "project": "MISC-04",
        "title": "Local Disaster Warning & Response Coordination Platform",
        "event": "REPLAYED — August 2018 Wayanad flood (IMD/CWC records)",
        "endpoints": [
            "GET /state",
            "POST /predict",
            "GET /model-comparison",
            "GET /ground-reports",
            "POST /ground-reports",
            "GET /settlements?timestep=T4",
            "GET /settlements/{settlement_id}",
            "GET /roads?timestep=T4",
            "GET /alerts?timestep=T4",
            "GET /priority?timestep=T4",
            "GET /routing/safe-route/{settlement_id}?timestep=T4",
            "GET /settlements/meta/timesteps",
            "GET /settlements/meta/model-info",
            "GET /settlements/meta/test-scenarios",
        ]
    }
