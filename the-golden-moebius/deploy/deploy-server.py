#!/usr/bin/env python3
"""Deploy only yt.cafe. Standard-library Python 3.10+, run as root on NYC1.

Releases and backups are retained. Other virtual hosts are never rewritten.
Unknown/ambiguous layouts fail before configuration changes.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import fcntl
import glob
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import uuid
import socket
import time
import urllib.request

DOMAIN = "yt.cafe"
BASE = Path("/var/www/the-golden-moebius")
CURRENT = BASE / "current"
BACKUPS = Path("/var/backups/the-golden-moebius")
SERVICE = "golden-moebius-leaderboard.service"
UNIT = Path("/etc/systemd/system") / SERVICE
STATE = Path("/var/lib/golden-moebius-leaderboard")
PORT = 8791
UNIT_MARKER = "# Managed by The Golden Moebius installer"


@dataclass
class Token:
    value: str
    start: int
    end: int


@dataclass
class Directive:
    words: list[str]
    start: int
    end: int
    children: list["Directive"] | None = None

    @property
    def name(self) -> str:
        return self.words[0] if self.words else ""


def tokenize(text: str) -> list[Token]:
    """Read braces outside strings, comments and Caddy/Nginx placeholders."""
    result: list[Token] = []
    i = 0
    while i < len(text):
        c = text[i]
        if c in " \t\r":
            i += 1
            continue
        if c == "#":
            end = text.find("\n", i)
            i = len(text) if end < 0 else end
            continue
        start = i
        if c in "\n;}":
            result.append(Token(c, i, i + 1)); i += 1; continue
        if c == "{" and not re.match(r"\{[\w$][^\s{}]*\}", text[i:]):
            result.append(Token(c, i, i + 1)); i += 1; continue
        if c in "\"'`":
            quote = c; i += 1; value = ""
            while i < len(text) and text[i] != quote:
                if text[i] == "\\" and quote != "`" and i + 1 < len(text):
                    i += 1
                value += text[i]; i += 1
            if i == len(text):
                raise ValueError("Unterminated configuration string; no changes made.")
            i += 1
            result.append(Token(value, start, i)); continue
        while i < len(text) and text[i] not in " \t\r\n;#":
            placeholder = re.match(r"\{[\w$][^\s{}]*\}", text[i:])
            if placeholder:
                i += len(placeholder.group()); continue
            if text[i] in "{}":
                break
            i += 1
        if i == start:
            raise ValueError("Unsupported configuration token; no changes made.")
        result.append(Token(text[start:i], start, i))
    return result


def parse(text: str, caddy: bool = False) -> list[Directive]:
    tokens = tokenize(text)
    def level(index: int, nested: bool = False) -> tuple[list[Directive], int]:
        nodes: list[Directive] = []
        words: list[str] = []
        start = 0
        while index < len(tokens):
            token = tokens[index]
            if token.value == "}":
                if not nested or words:
                    raise ValueError("Unsupported or unbalanced configuration; no changes made.")
                return nodes, index + 1
            if token.value == "{":
                node_start = start if words else token.start
                children, end = level(index + 1, True)
                nodes.append(Directive(words, node_start, tokens[end - 1].end, children))
                words = []; index = end; continue
            if token.value in (";", "\n"):
                next_token = index + 1
                while next_token < len(tokens) and tokens[next_token].value == "\n":
                    next_token += 1
                continuation = next_token < len(tokens) and tokens[next_token].value == "{"
                if words and (token.value == ";" or (caddy and not continuation and not words[-1].endswith(","))):
                    nodes.append(Directive(words, start, token.end)); words = []
                index += 1; continue
            if not words:
                start = token.start
            words.append(token.value); index += 1
        if nested:
            raise ValueError("Unbalanced configuration braces; no changes made.")
        if words:
            if not caddy:
                raise ValueError("Unterminated Nginx directive; no changes made.")
            nodes.append(Directive(words, start, len(text)))
        return nodes, index
    return level(0)[0]


def walk(nodes: list[Directive]):
    for node in nodes:
        yield node
        if node.children:
            yield from walk(node.children)


def command(args: list[str], *, diagnostic_dir: Path | None = None) -> str:
    result = subprocess.run(args, text=True, capture_output=True, timeout=90)
    if result.returncode:
        if diagnostic_dir is not None:
            diagnostic_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
            log = diagnostic_dir / "server-validation.log"
            log.write_text(result.stdout + result.stderr)
            log.chmod(0o600)
            detail = " Details are in " + str(log)
        else:
            detail = " Inspect the service/configuration on the server."
        raise RuntimeError(f"{Path(args[0]).name} failed (exit {result.returncode})." + detail)
    return result.stdout


def active(service: str) -> bool:
    return subprocess.run(["systemctl", "is-active", "--quiet", service], capture_output=True).returncode == 0


def selected_server(choice: str) -> str:
    choices = [name for name in ("caddy", "nginx") if active(name)]
    if choice != "auto":
        if choice not in choices:
            raise RuntimeError(f"The selected {choice} service is not active.")
        return choice
    if len(choices) != 1:
        raise RuntimeError("Expected exactly one active Caddy/Nginx service; found " + repr(choices) + ". Use -Server only after checking which one serves yt.cafe.")
    return choices[0]


def site_hosts(words: list[str]) -> set[str]:
    hosts = set()
    for word in words:
        for address in word.split(","):
            if not address:
                continue
            address = re.sub(r"^https?://", "", address).rstrip("/")
            host = address.split(":", 1)[0]
            hosts.add(host)
    return hosts


def caddy_files(path: Path, seen: set[Path] | None = None):
    seen = set() if seen is None else seen
    path = path.resolve()
    if path in seen:
        return
    seen.add(path)
    text = path.read_text()
    yield path, text
    for node in parse(text, True):
        if node.name == "import" and len(node.words) == 2:
            raw = node.words[1]
            if "{" in raw:
                raise RuntimeError("A variable import path needs manual inspection; no changes made.")
            candidate = Path(raw) if Path(raw).is_absolute() else path.parent / raw
            for entry in sorted(glob.glob(str(candidate))):
                if Path(entry).is_file():
                    yield from caddy_files(Path(entry), seen)


def caddy_routes() -> str:
    return (f"    encode gzip zstd\n"
            f"    handle /api/west-bank/* {{\n"
            f"        header Cache-Control no-store\n"
            f"        reverse_proxy 127.0.0.1:{PORT} {{\n"
            f"            header_up X-Golden-Client {{remote_host}}\n"
            f"        }}\n    }}\n"
            f"    handle {{\n        root * {CURRENT}/public\n        file_server\n    }}\n")


def caddy_plan(diagnostic_dir: Path) -> tuple[dict[Path, str], list[str]]:
    service = command(["systemctl", "show", "caddy", "-p", "ExecStart", "--value"])
    if "--resume" in service:
        raise RuntimeError("Caddy runs with --resume; its active source needs inspection before editing.")
    match = re.search(r"--config(?:=|\s+)(/[^\s;]+)", service)
    config = Path(match.group(1) if match else "/etc/caddy/Caddyfile")
    if not config.is_file() or ("--adapter" in service and "caddyfile" not in service):
        raise RuntimeError("This installer requires a file-backed Caddyfile service configuration.")
    binary = shutil.which("caddy")
    if not binary:
        raise RuntimeError("The Caddy executable is unavailable.")
    adapted = json.loads(command([binary, "adapt", "--config", str(config), "--adapter", "caddyfile"], diagnostic_dir=diagnostic_dir))
    target_in_active_source = f'"{DOMAIN}"' in json.dumps(adapted)
    plans: dict[Path, str] = {}
    found = 0
    preserve = {"tls", "log", "bind", "header", "basic_auth", "basicauth", "request_body"}
    for path, text in caddy_files(config):
        edits = []
        for node in parse(text, True):
            if node.children is None or DOMAIN not in site_hosts(node.words):
                continue
            hosts = site_hosts(node.words)
            if not hosts <= {DOMAIN, "www." + DOMAIN}:
                raise RuntimeError("The yt.cafe Caddy block also serves another hostname; refusing to alter it.")
            if any(n.name == "import" for n in walk(node.children)):
                raise RuntimeError("The yt.cafe block imports a snippet; inspect its TLS/auth/routing before replacing it.")
            # Authentication nested inside a handler must never be dropped.
            for child in node.children:
                if child.children and child.name not in preserve:
                    if any(n.name in {"basic_auth", "basicauth", "forward_auth"} for n in walk(child.children)):
                        raise RuntimeError("Nested authentication needs manual preservation; no changes made.")
                if child.name == "forward_auth":
                    raise RuntimeError("Forward authentication needs manual preservation; no changes made.")
            kept = [text[n.start:n.end].strip() for n in node.children if n.name in preserve]
            body = "\n".join("    " + line for value in kept for line in value.splitlines())
            if body:
                body += "\n"
            body += caddy_routes()
            header = ", ".join(node.words).replace(",,", ",") if len(node.words) > 1 else node.words[0]
            # Preserve the exact site-address header, including explicit scheme/port.
            opening = text.find("{", node.start, node.end)
            header = text[node.start:opening].strip()
            edits.append((node.start, node.end, header + " {\n" + body + "}"))
            found += 1
        for start, end, replacement in reversed(edits):
            text = text[:start] + replacement + text[end:]
        if edits:
            plans[path] = text
    if not found:
        if target_in_active_source:
            raise RuntimeError("yt.cafe is generated by an unsupported Caddy import/template; no changes made.")
        text = config.read_text().rstrip() + f"\n\n{DOMAIN} {{\n" + caddy_routes() + "}\n"
        plans[config.resolve()] = text
    return plans, [binary, "validate", "--config", str(config), "--adapter", "caddyfile"]


def nginx_plan(diagnostic_dir: Path) -> tuple[dict[Path, str], list[str]]:
    binary = shutil.which("nginx")
    if not binary:
        raise RuntimeError("The Nginx executable is unavailable.")
    service = command(["systemctl", "show", "nginx", "-p", "ExecStart", "--value"])
    match = re.search(r"(?:^|\s)-c\s+(/[^\s;]+)", service)
    config = match.group(1) if match else "/etc/nginx/nginx.conf"
    dump = command([binary, "-T", "-c", config], diagnostic_dir=diagnostic_dir)
    paths = {Path(s).resolve() for s in re.findall(r"^# configuration file (.+):$", dump, re.M)}
    if not paths:
        raise RuntimeError("Could not identify included Nginx source files; no changes made.")
    plans: dict[Path, str] = {}
    edited = 0
    for path in sorted(paths):
        text = path.read_text(); edits = []
        for node in walk(parse(text)):
            if node.name != "server" or node.children is None:
                continue
            names = [n for n in node.children if n.name == "server_name"]
            hosts = {name for n in names for name in n.words[1:]}
            if DOMAIN not in hosts:
                continue
            if not hosts <= {DOMAIN, "www." + DOMAIN}:
                raise RuntimeError("The yt.cafe Nginx server also serves another hostname; refusing to alter it.")
            redirects = [n for n in node.children if n.name == "return" and len(n.words) > 1 and n.words[1] in {"301", "302", "307", "308"}]
            if redirects:
                continue  # Keep existing HTTP-to-HTTPS (or www) redirects.
            for child in node.children:
                if child.name == "auth_request":
                    raise RuntimeError("Nginx subrequest authentication needs manual preservation; no changes made.")
                if child.children and child.name == "location":
                    if any(".well-known" in word for word in child.words):
                        continue
                    if any(n.name in {"auth_basic", "auth_basic_user_file", "auth_request", "allow", "deny", "satisfy", "limit_except"} for n in walk(child.children)):
                        raise RuntimeError("Location-level Nginx access controls need manual preservation; no changes made.")
            kept = []
            for child in node.children:
                if child.name == "location":
                    if any(".well-known" in word for word in child.words):
                        kept.append(text[child.start:child.end].strip())
                elif child.name not in {"root", "index", "try_files", "return", "rewrite", "error_page", "proxy_pass", "fastcgi_pass", "uwsgi_pass", "scgi_pass"}:
                    kept.append(text[child.start:child.end].strip())
            body = "\n".join("    " + line for value in kept for line in value.splitlines())
            body += (f"\n    root {CURRENT}/public;\n    index index.html;\n"
                     f"    location ^~ /api/west-bank/ {{\n        client_max_body_size 768000;\n"
                     f"        proxy_pass http://127.0.0.1:{PORT};\n        proxy_set_header X-Golden-Client $remote_addr;\n"
                     f"        proxy_set_header Host $host;\n        proxy_read_timeout 20s;\n"
                     f"        proxy_cache off;\n        add_header Cache-Control no-store always;\n    }}\n"
                     f"    location / {{\n        try_files $uri $uri/ =404;\n    }}\n")
            edits.append((node.start, node.end, "server {\n" + body + "}")); edited += 1
        for start, end, replacement in reversed(edits):
            text = text[:start] + replacement + text[end:]
        if edits:
            plans[path] = text
    if not edited:
        raise RuntimeError("No editable, non-redirect yt.cafe Nginx server was found. Existing TLS/domain configuration needs inspection; no changes made.")
    return plans, [binary, "-t", "-c", config]


def atomic_write(path: Path, data: bytes, metadata: dict | None = None):
    handle, name = tempfile.mkstemp(prefix=".golden-moebius-", dir=path.parent)
    try:
        with os.fdopen(handle, "wb") as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        if metadata:
            os.chmod(name, metadata["mode"]); os.chown(name, metadata["uid"], metadata["gid"])
        else:
            os.chmod(name, 0o644)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def set_link(target: str | None):
    if target is None:
        if CURRENT.is_symlink():
            CURRENT.unlink()
        return
    temporary = BASE / (".current-" + uuid.uuid4().hex)
    temporary.symlink_to(target, target_is_directory=True)
    os.replace(temporary, CURRENT)


def extract_release(archive: Path, target: Path):
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        if len(members) > 2000 or sum(m.size for m in members) > 100 * 1024 * 1024:
            raise ValueError("The release archive exceeds its size/file limits.")
        names = set()
        for member in members:
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or "\\" in member.name or not path.parts:
                raise ValueError("Unsafe path in release archive.")
            if member.name in names:
                raise ValueError("Duplicate path in release archive.")
            names.add(member.name)
            if not (member.isfile() or member.isdir()):
                raise ValueError("Only regular files/directories are permitted in a release.")
        manifest_member = bundle.getmember("manifest-sha256.json")
        stream = bundle.extractfile(manifest_member)
        if stream is None:
            raise ValueError("Missing release manifest.")
        manifest = json.load(stream)
        if not isinstance(manifest, dict) or not all(isinstance(k, str) and isinstance(v, str) and re.fullmatch(r"[0-9a-f]{64}", v) for k, v in manifest.items()):
            raise ValueError("Invalid release manifest.")
        actual = {m.name for m in members if m.isfile() and m.name != "manifest-sha256.json"}
        if set(manifest) != actual:
            raise ValueError("The release manifest does not match archive contents.")
        target.mkdir(parents=True, mode=0o755)
        for member in members:
            destination = target.joinpath(*PurePosixPath(member.name).parts)
            if member.isdir():
                destination.mkdir(parents=True, exist_ok=True, mode=0o755); continue
            destination.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            source = bundle.extractfile(member)
            if source is None:
                raise ValueError("Unreadable archive member.")
            data = source.read()
            if member.name != "manifest-sha256.json" and hashlib.sha256(data).hexdigest() != manifest[member.name]:
                raise ValueError("Release checksum mismatch: " + member.name)
            destination.write_bytes(data); destination.chmod(0o644)


def service_state() -> dict:
    def query(option: str) -> str:
        result = subprocess.run(["systemctl", option, SERVICE], text=True, capture_output=True, timeout=15)
        return result.stdout.strip()
    return {"active": query("is-active") == "active", "enabled": query("is-enabled") == "enabled"}


def leaderboard_unit(node: str) -> str:
    return f"""{UNIT_MARKER}
[Unit]
Description=The Golden Moebius - West Bank leaderboard
After=network.target

[Service]
Type=simple
DynamicUser=yes
StateDirectory=golden-moebius-leaderboard
StateDirectoryMode=0700
WorkingDirectory={CURRENT}/leaderboard
ExecStart={node} --disable-proto=throw --max-old-space-size=128 {CURRENT}/leaderboard/server.mjs
Environment=NODE_ENV=production
Environment=PORT={PORT}
Restart=on-failure
RestartSec=3
TimeoutStopSec=15
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
LockPersonality=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
MemoryMax=384M
TasksMax=64

[Install]
WantedBy=multi-user.target
"""


def backend_preflight() -> str:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("NYC1 needs an existing Node.js 22+ runtime for the leaderboard; none was found. No configuration changes made.")
    node = str(Path(node).resolve())
    if not re.fullmatch(r"/[A-Za-z0-9_./-]+", node) or node.startswith(("/root/", "/home/")):
        raise RuntimeError("The Node.js runtime must be installed system-wide, outside home directories. No configuration changes made.")
    version = command([node, "--version"]).strip()
    if not re.fullmatch(r"v\d+\.\d+\.\d+", version) or int(version.split(".")[0][1:]) < 22:
        raise RuntimeError("The leaderboard needs Node.js 22 or later on NYC1. Existing software was not changed.")
    if UNIT.is_symlink() or (UNIT.exists() and UNIT_MARKER not in UNIT.read_text()):
        raise RuntimeError("The leaderboard service path belongs to an unknown configuration; no changes made.")
    with socket.socket() as probe:
        probe.settimeout(1)
        occupied = probe.connect_ex(("127.0.0.1", PORT)) == 0
    if occupied and not UNIT.exists():
        raise RuntimeError(f"Port {PORT} is already occupied by another service; no changes made.")
    return node


def check_backend(expected: str):
    failure = "not ready"
    for attempt in range(15):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/west-bank/health", timeout=2) as response:
                health = json.load(response)
            if health.get("ok") and health.get("build") == expected:
                return
            failure = "another release is responding"
        except (OSError, ValueError) as error:
            failure = type(error).__name__
        if attempt < 14:
            time.sleep(0.3)
    raise RuntimeError("Leaderboard health check failed: " + failure)


def restore(backup: Path):
    data = json.loads((backup / "restore.json").read_text())
    leaderboard = data.get("leaderboard")
    if leaderboard and UNIT.exists():
        command(["systemctl", "daemon-reload"], diagnostic_dir=backup)
        command(["systemctl", "stop", SERVICE], diagnostic_dir=backup)
        if not leaderboard["enabled"]:
            command(["systemctl", "disable", SERVICE], diagnostic_dir=backup)
    for item in data["configs"]:
        target = Path(item["path"])
        if item.get("existed", True):
            atomic_write(target, (backup / item["backup"]).read_bytes(), item)
        elif target.exists():
            target.unlink()
    set_link(data["previous_target"])
    if leaderboard:
        command(["systemctl", "daemon-reload"], diagnostic_dir=backup)
        if leaderboard["enabled"]:
            command(["systemctl", "enable", SERVICE], diagnostic_dir=backup)
        if leaderboard["active"]:
            command(["systemctl", "start", SERVICE], diagnostic_dir=backup)
    command(data["validator"], diagnostic_dir=backup)
    command(["systemctl", "reload", data["server"]], diagnostic_dir=backup)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--sha256")
    parser.add_argument("--server", choices=["auto", "caddy", "nginx"], default="auto")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--rollback", type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError("Run as root or via sudo. No changes have been made.")
    with open("/var/lock/the-golden-moebius.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return deploy_locked(args)


def deploy_locked(args) -> int:
    if args.rollback:
        backup = args.rollback.resolve()
        if not backup.is_relative_to(BACKUPS.resolve()):
            raise ValueError("Rollback must point to this site's backup directory.")
        restore(backup); print("Rollback restored. Verify https://yt.cafe/."); return 0
    diagnostics = Path(__file__).resolve().parent / ".diagnostics"
    server = selected_server(args.server)
    plans, validator = caddy_plan(diagnostics) if server == "caddy" else nginx_plan(diagnostics)
    node = backend_preflight()
    plans[UNIT] = leaderboard_unit(node)
    print(f"Detected {server}; {len(plans)} configuration file(s) will be updated for yt.cafe only.")
    if not args.apply:
        print("Inspection only: no website or configuration changes made.")
        return 0
    if not args.archive or not args.sha256 or not re.fullmatch(r"[0-9a-f]{64}", args.sha256):
        raise ValueError("Apply requires an archive and its SHA-256 checksum.")
    if hashlib.sha256(args.archive.read_bytes()).hexdigest() != args.sha256:
        raise ValueError("Uploaded archive checksum mismatch.")
    if CURRENT.exists() and not CURRENT.is_symlink():
        raise RuntimeError("The deployment's current path is a real directory; refusing to replace it.")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    release = BASE / "releases" / stamp
    backup = BACKUPS / stamp
    BASE.mkdir(parents=True, exist_ok=True, mode=0o755)
    (BASE / "releases").mkdir(exist_ok=True, mode=0o755)
    extract_release(args.archive, release)
    for required in ("public/index.html", "public/site-version.json", "public/viewer/index.html", "public/viewer/play.html", "public/gold-rush/index.html", "public/gold-rush/play.html", "public/west-bank/index.html", "public/west-bank/play.html", "public/assets/site.css", "leaderboard/server.mjs", "leaderboard/verify.mjs"):
        if not (release / required).is_file():
            raise ValueError("Incomplete release: missing " + required)
    version = json.loads((release / "public/site-version.json").read_text())
    if not isinstance(version, dict) or not re.fullmatch(r"[0-9a-f]{16}", str(version.get("build", ""))):
        raise ValueError("Invalid site version marker; no configuration changes made.")
    backup.mkdir(parents=True, mode=0o700)
    metadata = []
    prior_service = service_state()
    for i, path in enumerate(plans):
        name = f"config-{i}.backup"
        existed = path.exists()
        if existed:
            info = path.stat()
            (backup / name).write_bytes(path.read_bytes()); (backup / name).chmod(0o600)
            item = {"path": str(path), "backup": name, "mode": stat.S_IMODE(info.st_mode), "uid": info.st_uid, "gid": info.st_gid}
        else:
            item = {"path": str(path), "backup": name, "mode": 0o644, "uid": 0, "gid": 0}
        item["existed"] = existed
        metadata.append(item)
    restore_data = {"server": server, "validator": validator, "previous_target": os.readlink(CURRENT) if CURRENT.is_symlink() else None, "configs": metadata, "release": str(release), "leaderboard": prior_service}
    (backup / "restore.json").write_text(json.dumps(restore_data, indent=2)); (backup / "restore.json").chmod(0o600)
    shutil.copy2(__file__, backup / "deploy-server.py")
    try:
        for item in metadata:
            path = Path(item["path"]); atomic_write(path, plans[path].encode(), item)
        command(validator, diagnostic_dir=backup)
        # Snapshot live score data only after the writer has stopped. Rollbacks
        # restore service/configuration, never discard newly earned scores.
        if prior_service["active"]:
            command(["systemctl", "stop", SERVICE], diagnostic_dir=backup)
        if STATE.exists():
            data_backup = backup / "leaderboard-state"
            data_backup.mkdir(mode=0o700)
            for name in ("signing.key", "leaderboard.json"):
                source = STATE / name
                if source.is_file():
                    (data_backup / name).write_bytes(source.read_bytes()); (data_backup / name).chmod(0o600)
        set_link(str(release))
        command(["systemctl", "daemon-reload"], diagnostic_dir=backup)
        command(["systemctl", "enable", SERVICE], diagnostic_dir=backup)
        command(["systemctl", "restart", SERVICE], diagnostic_dir=backup)
        check_backend(version["build"])
        command(["systemctl", "reload", server], diagnostic_dir=backup)
    except Exception:
        restore(backup)
        raise RuntimeError("Deployment failed; previous configuration and current release were restored. See " + str(backup)) from None
    report = {"status": "deployed", "domain": DOMAIN, "server": server, "backup": str(backup), "release": str(release), "version": version}
    (backup / "deployment.json").write_text(json.dumps(report, indent=2))
    print("Leaderboard data: " + str(STATE) + " (retained across releases).")
    print("Old web-root contents were left in place. Backup: " + str(backup))
    print("Rollback: sudo python3 " + str(backup / "deploy-server.py") + " --rollback " + str(backup))
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired, tarfile.TarError) as error:
        print("DEPLOYMENT STOPPED: " + str(error), file=sys.stderr)
        raise SystemExit(1)
