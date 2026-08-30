"""Sighting-frame path safety (Phase 5).

The review panel fetches a saved sighting crop over `GET /cv/sightings/{name}`.
`name` is officer-supplied, so it must resolve to a file *inside* the sightings
dir and nowhere else. This guard is pure (no cv2/torch) so it imports and tests
in the GPU-less sandbox.
"""
import os


def safe_basename(name: str) -> "str | None":
    """Return `name` iff it is a bare filename (no separators, not `.`/`..`),
    else None. Blocks path traversal like `../../etc/passwd` or absolute paths."""
    if not name or "/" in name or "\\" in name or name in (".", ".."):
        return None
    return name


def resolve_frame(name: str, base_dir: str) -> "str | None":
    """Resolve a sighting-frame basename to an existing path inside `base_dir`,
    or None if the name is unsafe or the file does not exist."""
    safe = safe_basename(name)
    if safe is None:
        return None
    path = os.path.join(base_dir, safe)
    return path if os.path.isfile(path) else None
