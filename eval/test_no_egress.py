"""M0-T5, NFR-6 / CLAUDE.md rule 6: no third-party network calls anywhere in
the pipeline.

This does not use the pytest-socket package: the requirement is a CIDR-range
allowlist (localhost plus 192.168.0.0/16 and 10.0.0.0/8), which is not what
pytest-socket's exact-hostname allowlist checks, so this implements the same
idea directly with the standard library ("a similar approach", BUILD_PLAN.md
M0-T5) instead of adding an unpinned dependency for it.

The guard patches socket.socket.connect/connect_ex for the duration of this
module's tests only, then imports every engine/ and docs-lane/ module (their
import-time code is where an accidental network call would first run),
scans the built client bundle for hardcoded external hosts, and scans the
server's Rust source the same way. A permanent canary test proves the guard
itself still blocks a disallowed connection, which is the automated stand-in
for M0-T5's manual check ("write one deliberately bad import ... confirm the
suite catches it, then remove it") staying true on every future run.
"""

from __future__ import annotations

import importlib.util
import ipaddress
import re
import socket
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
ENGINE_DIR = REPO_ROOT / "engine"
DOCS_LANE_DIR = REPO_ROOT / "docs-lane"
CLIENT_DIST_DIR = REPO_ROOT / "client" / "dist"
SERVER_SRC_DIR = REPO_ROOT / "server" / "src"

ALLOWED_NETWORKS = [
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("10.0.0.0/8"),
]

# A stable, well-known public IP used only to prove the guard blocks a
# disallowed target; never actually dialled (the guard raises before the
# real connect() syscall runs).
KNOWN_EXTERNAL_IP = "8.8.8.8"


class DisallowedEgressError(RuntimeError):
    """Raised instead of a real connect() when the target is not localhost
    or one of the two allowed LAN ranges (CLAUDE.md rule 6)."""


def _host_allowed(host: str) -> bool:
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        # Not a literal IP by the time connect() runs (the common HTTP-client
        # path already resolved it via getaddrinfo before calling connect()).
        # Fail closed rather than resolve it ourselves and risk a DNS lookup
        # leaking out as a side effect of the safety check itself.
        return False
    return any(ip in network for network in ALLOWED_NETWORKS)


_real_connect = socket.socket.connect
_real_connect_ex = socket.socket.connect_ex


def _guard(name: str, real: Any) -> Any:
    def guarded(self: socket.socket, address: Any, *args: Any, **kwargs: Any) -> Any:
        if self.family in (socket.AF_INET, socket.AF_INET6):
            host = address[0] if isinstance(address, tuple) else address
            if not _host_allowed(host):
                raise DisallowedEgressError(
                    f"{name}() blocked: {host!r} is outside localhost and "
                    "192.168.0.0/16 / 10.0.0.0/8 (CLAUDE.md rule 6)"
                )
        return real(self, address, *args, **kwargs)

    return guarded


@pytest.fixture(autouse=True)
def egress_guard() -> Iterator[None]:
    socket.socket.connect = _guard("connect", _real_connect)  # type: ignore[method-assign]
    socket.socket.connect_ex = _guard("connect_ex", _real_connect_ex)  # type: ignore[method-assign]
    try:
        yield
    finally:
        socket.socket.connect = _real_connect  # type: ignore[method-assign]
        socket.socket.connect_ex = _real_connect_ex  # type: ignore[method-assign]


def test_guard_blocks_a_disallowed_connection() -> None:
    """Canary: proves the mechanism itself still blocks egress. This is the
    permanent, automated form of M0-T5's one-time manual check ('add a
    deliberately bad import, confirm the suite catches it, then remove it') --
    performed once against a real engine/ import during development, then
    removed; this test keeps proving the same thing on every future run."""
    with pytest.raises(DisallowedEgressError):
        socket.create_connection((KNOWN_EXTERNAL_IP, 80), timeout=1)


def test_import_time_egress_is_caught(tmp_path: Path) -> None:
    """Step 3 canary: a module that phones home AT IMPORT TIME (the exact
    threat the import scan exists for) must be caught by the guard. Uses
    `requests.get()` to an external IP at top level and imports it through
    the same `_import_by_path` helper the scan uses, so this fails if the
    guard is removed, weakened, or bypassed for synthetic imports: without
    the guard the import either succeeds (no exception -- assert fails) or
    raises a real connection error instead of `DisallowedEgressError`
    (wrong exception -- assert fails)."""
    evil = tmp_path / "evil_egress_check.py"
    evil.write_text(
        "import requests\n"
        f'\nrequests.get("http://{KNOWN_EXTERNAL_IP}/", timeout=1)\n',
        encoding="utf-8",
    )
    with pytest.raises(DisallowedEgressError):
        _import_by_path(evil)


@pytest.mark.parametrize("host", ["127.0.0.1", "192.168.1.1", "10.0.0.1", "::1"])
def test_guard_allows_localhost_and_lan(host: str) -> None:
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    with socket.socket(family, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        try:
            sock.connect((host, 1))  # nothing listens on port 1; refusal is fine
        except DisallowedEgressError:
            pytest.fail(f"{host} should be allowed but the guard blocked it")
        except OSError:
            pass  # connection refused / timed out -- the guard let it through


def _iter_py_files(directory: Path) -> list[Path]:
    if not directory.is_dir():
        return []
    return sorted(p for p in directory.glob("*.py") if p.name != "__init__.py")


def _import_by_path(path: Path) -> None:
    # M0-T5-fix, Step 1 findings (read before changing anything below).
    #
    # Exactly four engine modules failed this scan -- detect.py,
    # scheduler.py, topology.py, track.py -- and every one shares the same
    # two lines: `from __future__ import annotations` near the top and an
    # `@dataclass(frozen=True)` below it. Modules with only one of the two
    # (e.g. reid.py has the future import but no dataclass; test files have
    # neither) import cleanly, so neither feature is broken on its own. The
    # combination is what fails, inside CPython's own dataclasses machinery:
    #
    # 1. The future import makes ALL annotations strings (PEP 563), so
    #    `@dataclass` receives e.g. `'int | None'` instead of a type object.
    # 2. On Python 3.13, `_process_class` runs every string annotation
    #    through `_is_type(..., dataclasses.KW_ONLY, ...)` to detect the
    #    `KW_ONLY` sentinel. For a module-less name like `'int | None'` it
    #    resolves the name via `sys.modules.get(cls.__module__).__dict__`.
    # 3. This harness built the module with
    #    `spec_from_file_location("_egress_check_<stem>", path)` and called
    #    `exec_module` WITHOUT registering it in `sys.modules` (the
    #    standard importlib recipe's `sys.modules[name] = module` step was
    #    missing). So `sys.modules.get("_egress_check_detect")` returns
    #    None and dataclasses crashes with
    #    `AttributeError: 'NoneType' object has no attribute '__dict__'`.
    #    A real `import engine.detect` never hits this because the import
    #    system always registers the module first -- the harness import was
    #    unfaithful, not the engine code (which is why the fix lives here
    #    and no engine module is touched).
    #
    # Step 2 fix: register the synthetic module in `sys.modules` before
    # `exec_module` (restoring any previous entry afterwards), exactly as a
    # real import would. The socket guard stays active throughout, so an
    # import-time `connect()` to a disallowed host still raises -- the
    # guard is not weakened, the import is just made faithful. No
    # `unittest.mock` rework was needed: the harness already intercepts at
    # runtime (socket patching), there is no static AST scan to replace,
    # and runtime interception is annotation-style-agnostic by
    # construction. No exclusion list: every engine/docs-lane file is still
    # imported by this scan.
    name = f"_egress_check_{path.stem}"
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    previous = sys.modules.get(name)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        if previous is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = previous


@pytest.mark.parametrize("module_path", _iter_py_files(ENGINE_DIR), ids=lambda p: p.name)
def test_engine_module_import_makes_no_egress(module_path: Path) -> None:
    _import_by_path(module_path)


@pytest.mark.parametrize("module_path", _iter_py_files(DOCS_LANE_DIR), ids=lambda p: p.name)
def test_docs_lane_module_import_makes_no_egress(module_path: Path) -> None:
    _import_by_path(module_path)


# Deliberately narrower than "any http(s):// substring": a built JS bundle
# legitimately contains URLs that are never dialled -- React alone embeds
# reactjs.org doc links in its dev-mode error messages and the
# www.w3.org/2000/svg XML namespace string. Matching those as violations
# would make this test permanently red for reasons that have nothing to do
# with egress. Instead this looks for URLs that sit in actual
# resource-loading syntax: markup attributes, CSS url(), fetch/WebSocket
# call sites. HTML and CSS files satisfy this naturally (href=, src=,
# url()), and it still catches the case rule 6 actually cares about -- a
# CDN font, a hosted map tile server, an injected <script src>.
RESOURCE_URL_PATTERNS = [
    re.compile(r'(?:src|href)\s*=\s*["\'](https?://[a-zA-Z0-9.\-:/]+)', re.IGNORECASE),
    re.compile(r'url\(\s*["\']?(https?://[a-zA-Z0-9.\-:/]+)', re.IGNORECASE),
    re.compile(r'\bfetch\(\s*["\'](https?://[a-zA-Z0-9.\-:/]+)', re.IGNORECASE),
    re.compile(r"new\s+WebSocket\(\s*[\"'](wss?://[a-zA-Z0-9.\-:/]+)", re.IGNORECASE),
]
HOST_RE = re.compile(r"\w+://([a-zA-Z0-9.-]+)")


def _external_hosts_in_text(text: str) -> set[str]:
    hosts: set[str] = set()
    for pattern in RESOURCE_URL_PATTERNS:
        for match in pattern.finditer(text):
            host_match = HOST_RE.match(match.group(1))
            if not host_match:
                continue
            host = host_match.group(1)
            if host == "localhost":
                continue
            try:
                ip = ipaddress.ip_address(host)
            except ValueError:
                hosts.add(host)  # a real hostname literal: always external
                continue
            if not any(ip in network for network in ALLOWED_NETWORKS):
                hosts.add(host)
    return hosts


def test_client_build_output_has_no_external_hosts() -> None:
    if not CLIENT_DIST_DIR.is_dir():
        pytest.skip("client/dist not built; run `npm run build` in client/ first")
    offenders: dict[str, set[str]] = {}
    for path in CLIENT_DIST_DIR.rglob("*"):
        if path.is_file() and path.suffix in {".html", ".js", ".css", ".map"}:
            hosts = _external_hosts_in_text(path.read_text(encoding="utf-8", errors="ignore"))
            if hosts:
                offenders[str(path.relative_to(REPO_ROOT))] = hosts
    assert not offenders, f"external hosts found in built client bundle: {offenders}"


def test_server_source_has_no_external_hosts() -> None:
    offenders: dict[str, set[str]] = {}
    for path in SERVER_SRC_DIR.rglob("*.rs"):
        hosts = _external_hosts_in_text(path.read_text(encoding="utf-8"))
        if hosts:
            offenders[str(path.relative_to(REPO_ROOT))] = hosts
    assert not offenders, f"external hosts found in server source: {offenders}"
