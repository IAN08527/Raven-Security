"""Active Re-ID target registry (Backlog #5, Phase 3 + 4).

Holds the live set of targets the match loop compares detected people against —
a process-local store, separate from any one `CVSession`, because a sighting
happens on a *different* camera than the one the officer locked from.

Phase 4 (D8 topology gate) makes `watching` a set of **time windows**: a target
is matched on a camera only while that camera's window is open. On lock-on the
engine arms the adjacent downstream cameras (`arm`); a sighting chains the next
hop; `expire` prunes closed windows so the GPU lane frees. `watching=None` still
means "match everywhere" (used only before a target is topology-armed).

The per-(target, camera) cooldown suppresses a locked person from logging a
fresh sighting on every frame — one row per re-appearance, not per frame.
"""
import time

from .reid import from_b64


def _now() -> float:
    return time.time()


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
        """Arm a target for matching. `feature_b64` is the lock-on wire vector.

        `watching` is None (match everywhere) until the topology gate arms real
        downstream windows via `arm`.
        """
        self._targets[target_id] = {
            "id": target_id,
            "vector": from_b64(feature_b64),
            "case_id": case_id,
            "source_camera": source_camera,
            "watching": watching,
        }

    def arm(self, target_id: str, windows: dict) -> None:
        """Merge topology travel-time windows onto a target (Phase 4).

        Called on lock-on (downstream of the source camera) and again on each
        sighting (downstream of the sighting camera) to chain the next hop.
        """
        t = self._targets.get(target_id)
        if t is None:
            return
        current = t.get("watching")
        if current is None:
            current = {}
        current.update(windows)
        t["watching"] = current

    def unregister(self, target_id: str) -> None:
        self._targets.pop(target_id, None)
        for key in [k for k in self._cooldown if k[0] == target_id]:
            self._cooldown.pop(key, None)

    def for_camera(self, camera_code: str, now: float | None = None) -> list[dict]:
        """Targets that should be matched on `camera_code` right now.

        A target with `watching=None` matches on any camera. A topology-armed
        target matches only while `camera_code`'s window is open.
        """
        if now is None:
            now = _now()
        out = []
        for t in self._targets.values():
            watching = t.get("watching")
            if watching is None:
                out.append(t)
                continue
            w = watching.get(camera_code)
            if w is not None and w["open_at"] <= now <= w["close_at"]:
                out.append(t)
        return out

    def expire(self, now: float | None = None) -> None:
        """Drop windows that have fully closed so the GPU lane frees (Phase 4)."""
        if now is None:
            now = _now()
        for t in self._targets.values():
            watching = t.get("watching")
            if not watching:
                continue
            for cam in [c for c, w in watching.items() if w["close_at"] < now]:
                watching.pop(cam, None)

    def has_open_windows(self, target_id: str, now: float | None = None) -> bool:
        """True if the target still has any camera window open or upcoming."""
        if now is None:
            now = _now()
        t = self._targets.get(target_id)
        if t is None:
            return False
        watching = t.get("watching")
        if watching is None:
            return True
        return any(w["close_at"] >= now for w in watching.values())

    def in_cooldown(self, target_id: str, camera: str, window_s: float) -> bool:
        last = self._cooldown.get((target_id, camera))
        return last is not None and (time.monotonic() - last) < window_s

    def mark(self, target_id: str, camera: str) -> None:
        self._cooldown[(target_id, camera)] = time.monotonic()

    def clear(self) -> None:
        self._targets.clear()
        self._cooldown.clear()


registry = TargetRegistry()
