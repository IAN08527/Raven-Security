"""Engine node FastAPI app (M1-T3, D20). Exposes `/calibrate` for the server
to (re)trigger calibration, per API_CONTRACTS.md §4.
"""

from __future__ import annotations

import logging
import os

import httpx
from fastapi import FastAPI
from pydantic import BaseModel

from engine.scheduler import CalibrationResult, calibrate

logger = logging.getLogger(__name__)

app = FastAPI(title="raven-engine")

DETECTOR_PATH = os.environ.get("RAVEN_DETECTOR_PATH", "yolov8n.pt")
CALIBRATION_RESOLUTION = (640, 640)
CALIBRATION_DURATION_S = 10.0
SERVER_URL = os.environ.get("RAVEN_SERVER_URL", "http://server:8443")
NODE_NAME = os.environ.get("RAVEN_NODE_NAME", "engine-node-1")
NODE_ADDRESS = os.environ.get("RAVEN_NODE_ADDRESS", "https://localhost:8756")


class CalibrateResponse(BaseModel):
    budget_dps: float
    vram_ceiling: int
    max_batch: int
    gpu_name: str
    registered: bool


def register_with_server(result: CalibrationResult, server_url: str = SERVER_URL) -> bool:
    """POSTs the calibration result to the server (API_CONTRACTS.md §2.8,
    `POST /v1/nodes`, D14): a node under the quality floor registers itself
    as degraded. Returns whether registration succeeded rather than raising,
    so a server outage does not hide a real calibration measurement behind a
    500 -- but the failure still surfaces in the response (rule 9: fail into
    a visible place, never a silent drop), not just a log line."""
    payload = {
        "name": NODE_NAME,
        "address": NODE_ADDRESS,
        "budget_dps": result.budget_dps,
        "vram_ceiling": result.vram_ceiling_bytes,
        "max_batch": result.max_batch,
        "gpu_name": result.gpu_name,
        "status": "degraded" if result.degraded else "ready",
    }
    try:
        response = httpx.post(f"{server_url}/v1/nodes", json=payload, timeout=10.0)
        response.raise_for_status()
    except httpx.HTTPError:
        logger.exception("failed to register calibration result with the server")
        return False
    return True


@app.post("/calibrate")
def post_calibrate() -> CalibrateResponse:
    """Runs calibration, registers the result with the server, and returns
    it (API_CONTRACTS.md §4: `POST /calibrate` -> `{budget_dps,
    vram_ceiling, max_batch, gpu_name}`)."""
    result = calibrate(DETECTOR_PATH, CALIBRATION_RESOLUTION, duration_s=CALIBRATION_DURATION_S)
    registered = register_with_server(result)
    return CalibrateResponse(
        budget_dps=result.budget_dps,
        vram_ceiling=result.vram_ceiling_bytes,
        max_batch=result.max_batch,
        gpu_name=result.gpu_name,
        registered=registered,
    )
