"""M1-T3. `/calibrate` endpoint and degraded-registration tests."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
from fastapi.testclient import TestClient

from engine.main import app
from engine.scheduler import CalibrationResult


def _low_throughput_result() -> CalibrationResult:
    """A mock calibration result below DEGRADED_BUDGET_DPS_FLOOR (10)."""
    return CalibrationResult(
        budget_dps=5.0,
        vram_ceiling_bytes=1_000_000_000,
        max_batch=4,
        gpu_name="mock-gpu",
    )


def test_low_throughput_registers_node_as_degraded() -> None:
    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None

    with (
        patch("engine.main.calibrate", return_value=_low_throughput_result()),
        patch("httpx.post", return_value=mock_response) as mock_post,
    ):
        client = TestClient(app)
        response = client.post("/calibrate")

    assert response.status_code == 200
    body = response.json()
    assert body["budget_dps"] == 5.0
    assert body["registered"] is True

    mock_post.assert_called_once()
    _args, kwargs = mock_post.call_args
    assert kwargs["json"]["status"] == "degraded"
    assert kwargs["json"]["budget_dps"] == 5.0


def test_healthy_throughput_registers_node_as_ready() -> None:
    healthy_result = CalibrationResult(
        budget_dps=100.0, vram_ceiling_bytes=1_000_000_000, max_batch=32, gpu_name="mock-gpu"
    )
    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None

    with (
        patch("engine.main.calibrate", return_value=healthy_result),
        patch("httpx.post", return_value=mock_response) as mock_post,
    ):
        client = TestClient(app)
        response = client.post("/calibrate")

    assert response.status_code == 200
    _args, kwargs = mock_post.call_args
    assert kwargs["json"]["status"] == "ready"


def test_registration_failure_is_visible_in_response_not_swallowed() -> None:
    """rule 9: a failed registration must surface, not just log-and-vanish."""
    with (
        patch("engine.main.calibrate", return_value=_low_throughput_result()),
        patch("httpx.post", side_effect=httpx.ConnectError("server unreachable")),
    ):
        client = TestClient(app)
        response = client.post("/calibrate")

    assert response.status_code == 200  # the real measurement is still returned
    body = response.json()
    assert body["registered"] is False
    assert body["budget_dps"] == 5.0
