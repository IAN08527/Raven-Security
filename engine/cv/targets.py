"""Active Re-ID target registry (Backlog #5, Phase 3).

A lock-on (Phase 2) is created and anchored on the Rust side, which then hands
the freshly minted `target_id` + fingerprint back to the engine here. This
module holds the live set of targets the match loop compares detected people
against — a process-local store, separate from any one `CVSession`, because a
sighting happens on a *different* camera than the one the officer locked from.

Phase 3: every active target is matched on every camera (`watching=None`).
Phase 4 (D8 topology gate) will populate `watching` with the armed downstream
cameras + windows so Re-ID only runs where and when it should; `for_camera`
already honours that gate, so Phase 4 is a registration change, not a rewrite.

The per-(target, camera) cooldown suppresses a locked person from logging a
fresh sighting on every frame — one row per re-appearance, not per frame.
"""
import time

from .reid import from_b64


class TargetRegistry:
    def __init__(self) -> None:
        self._targets: dict[str, dict] = {}
        self._cooldown: dict[tuple[str, str], float] = {}

    def register(
        self,
        target_id: str,
        feature_b64: str,
        case_id: str,
        source_camera: str,
        watching: dict | None = None,
    ) -> None:
        """Arm a target for matching. `feature_b64` is the lock-on wire vector."""
        self._targets[target_id] = {
            "id": target_id,
            "vector": from_b64(feature_b64),
            "case_id": case_id,
            "source_camera": source_camera,
            # None => match on every camera (Phase 3). Phase 4 sets a dict of
            # {camera_code: window} so only armed downstream cameras match.
            "watching": watching,
        }

    def unregister(self, target_id: str) -> None:
        self._targets.pop(target_id, None)
        for key in [k for k in self._cooldown if k[0] == target_id]:
            self._cooldown.pop(key, None)

    def for_camera(self, camera_code: str) -> list[dict]:
        """Targets that should be matched on `camera_code` right now."""
        out = []
        for t in self._targets.values():
            watching = t.get("watching")
            if watching is None or camera_code in watching:
                out.append(t)
        return out

    def in_cooldown(self, target_id: str, camera: str, window_s: float) -> bool:
        last = self._cooldown.get((target_id, camera))
        return last is not None and (time.monotonic() - last) < window_s

    def mark(self, target_id: str, camera: str) -> None:
        self._cooldown[(target_id, camera)] = time.monotonic()

    def clear(self) -> None:
        self._targets.clear()
        self._cooldown.clear()


registry = TargetRegistry()
