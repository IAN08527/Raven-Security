"""M1-T3. `/calibrate` endpoint and degraded-registration tests, plus the
engine service-token tests: `POST /v1/nodes` requires an admin JWT, so
`register_with_server` presents `RAVEN_ENGINE_TOKEN` (DEPLOYMENT.md
"First-time setup") and fails into a visible log line, never a crash."""

from __future__ import annotations

import logging
from unittest.mock import MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from engine.main import app, register_with_server
from engine.scheduler import CalibrationResult


def _low_throughput_result() -> CalibrationResult:
    """A mock calibration result below DEGRADED_BUDGET_DPS_FLOOR (10)."""
    return CalibrationResult(
        budget_dps=5.0,
        vram_ceiling_bytes=1_000_000_000,
        max_batch=4,
        gpu_name="mock-gpu",
    )


def _healthy_result() -> CalibrationResult:
    return CalibrationResult(
        budget_dps=100.0, vram_ceiling_bytes=1_000_000_000, max_batch=32, gpu_name="mock-gpu"
    )


def _ok_response(node_id: str = "node-1") -> MagicMock:
    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {"id": node_id, "budget_dps": 100.0}
    return mock_response


def _status_error(status_code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "http://server:8443/v1/nodes")
    response = httpx.Response(status_code, request=request)
    return httpx.HTTPStatusError(f"{status_code} error", request=request, response=response)


def test_low_throughput_registers_node_as_degraded(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RAVEN_ENGINE_TOKEN", "test-token")
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


def test_healthy_throughput_registers_node_as_ready(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RAVEN_ENGINE_TOKEN", "test-token")
    mock_response = MagicMock()
    mock_response.raise_for_status.return_value = None

    with (
        patch("engine.main.calibrate", return_value=_healthy_result()),
        patch("httpx.post", return_value=mock_response) as mock_post,
    ):
        client = TestClient(app)
        response = client.post("/calibrate")

    assert response.status_code == 200
    _args, kwargs = mock_post.call_args
    assert kwargs["json"]["status"] == "ready"


def test_registration_failure_is_visible_in_response_not_swallowed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """rule 9: a failed registration must surface, not just log-and-vanish."""
    monkeypatch.setenv("RAVEN_ENGINE_TOKEN", "test-token")
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


def test_register_without_token_logs_and_sends_nothing(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """No token: a clear actionable error, no HTTP attempt, no raise."""
    monkeypatch.delenv("RAVEN_ENGINE_TOKEN", raising=False)
    with (
        patch("httpx.post") as mock_post,
        caplog.at_level(logging.INFO, logger="engine.main"),
    ):
        assert register_with_server(_healthy_result()) is False
    mock_post.assert_not_called()
    assert "RAVEN_ENGINE_TOKEN not set" in caplog.text
    assert "DEPLOYMENT.md" in caplog.text


def test_register_with_token_sends_authorization_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Token set: the POST carries it as a Bearer credential."""
    monkeypatch.setenv("RAVEN_ENGINE_TOKEN", "test-token-abc")
    with patch("httpx.post", return_value=_ok_response()) as mock_post:
        assert register_with_server(_healthy_result()) is True
    _args, kwargs = mock_post.call_args
    assert kwargs["headers"] == {"Authorization": "Bearer test-token-abc"}


def test_register_401_logs_token_rejected(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """401: the token-rejected diagnostic, no raise, token never logged."""
    monkeypatch.setenv("RAVEN_ENGINE_TOKEN", "secret-token-xyz")
    with (
        patch("httpx.post", side_effect=_status_error(401)),
        caplog.at_level(logging.INFO, logger="engine.main"),
    ):
        assert register_with_server(_healthy_result()) is False
    assert "Engine token rejected by server" in caplog.text
    assert "secret-token-xyz" not in caplog.text


def test_register_403_logs_admin_role(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """403: the lacks-admin-role diagnostic, no raise, token never logged."""
    monkeypatch.setenv("RAVEN_ENGINE_TOKEN", "secret-token-xyz")
    with (
        patch("httpx.post", side_effect=_status_error(403)),
        caplog.at_level(logging.INFO, logger="engine.main"),
    ):
        assert register_with_server(_healthy_result()) is False
    assert "Engine token lacks admin role" in caplog.text
    assert "secret-token-xyz" not in caplog.text


def test_register_success_logs_node_id_without_token(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """200: success names the node and budget, never the token value."""
    monkeypatch.setenv("RAVEN_ENGINE_TOKEN", "secret-token-xyz")
    with (
        patch("httpx.post", return_value=_ok_response(node_id="node-7")),
        caplog.at_level(logging.INFO, logger="engine.main"),
    ):
        assert register_with_server(_healthy_result()) is True
    assert "Engine node registered: node-7" in caplog.text
    assert "budget_dps" in caplog.text
    assert "secret-token-xyz" not in caplog.text
