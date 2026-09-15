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

# Service-account token the engine presents on POST /v1/nodes. Read at call
# time (not import time) so tests and process managers can set it per run.
ENGINE_TOKEN_ENV_VAR = "RAVEN_ENGINE_TOKEN"


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
    a visible place, never a silent drop), not just a log line.

    `POST /v1/nodes` requires an admin JWT (server/src/api/nodes.rs), so
    the engine presents the service-account token from `RAVEN_ENGINE_TOKEN`
    (DEPLOYMENT.md "First-time setup") as a Bearer credential. The token
    value is never logged. Registration is never blocking: every failure
    path logs and returns False, so the node still serves local feeds."""
    payload = {
        "name": NODE_NAME,
        "address": NODE_ADDRESS,
        "budget_dps": result.budget_dps,
        "vram_ceiling": result.vram_ceiling_bytes,
        "max_batch": result.max_batch,
        "gpu_name": result.gpu_name,
        "status": "degraded" if result.degraded else "ready",
    }
    token = os.environ.get(ENGINE_TOKEN_ENV_VAR, "").strip()
    if not token:
        logger.error(
            "RAVEN_ENGINE_TOKEN not set — engine node cannot register with server. "
            "See DEPLOYMENT.md for setup."
        )
        return False
    headers = {"Authorization": f"Bearer {token}"}
    try:
        response = httpx.post(
            f"{server_url}/v1/nodes", json=payload, headers=headers, timeout=10.0
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code
        if status_code == 401:
            logger.error(
                "Engine token rejected by server — "
                "check RAVEN_ENGINE_TOKEN is a valid admin token"
            )
        elif status_code == 403:
            logger.error("Engine token lacks admin role — regenerate with an admin account")
        else:
            logger.exception("failed to register calibration result with the server")
        return False
    except httpx.HTTPError:
        logger.exception("failed to register calibration result with the server")
        return False
    node_id = "unknown"
    try:
        body = response.json()
        if isinstance(body, dict):
            node_id = str(body.get("id", "unknown"))
    except ValueError:
        node_id = "unknown"
    logger.info("Engine node registered: %s, budget_dps: %s", node_id, result.budget_dps)
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
