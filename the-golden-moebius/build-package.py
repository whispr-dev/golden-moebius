#!/usr/bin/env python3
"""Refresh the site payload and package the full self-contained project."""
from __future__ import annotations
import gzip
import hashlib
import io
import json
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "dist"
PROJECT_NAME = "the-golden-moebius"
VERSION = "1.1.1"


def write_archive(destination: Path, files: list[tuple[str, bytes]], prefix: str = ""):
    with destination.open("wb") as stream, gzip.GzipFile(filename="", mode="wb", fileobj=stream, mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
            for name, data in sorted(files):
                info = tarfile.TarInfo(prefix + name)
                info.size = len(data); info.mtime = 0; info.mode = 0o644
                archive.addfile(info, io.BytesIO(data))


def main():
    engine = hashlib.sha256((PUBLIC / "west-bank/engine.js").read_bytes()).hexdigest()
    (PUBLIC / "west-bank/engine-version.js").write_text("// Generated from the simulation, shared by client and scorekeeper.\nexport const ENGINE_VERSION = '" + engine + "';\n")
    # Identify public assets and backend code together, excluding the marker itself.
    public_paths = sorted(p for p in PUBLIC.rglob("*") if p.is_file() and p.name != "site-version.json")
    digest = hashlib.sha256()
    for path in public_paths:
        digest.update(path.relative_to(PUBLIC).as_posix().encode()); digest.update(b"\0"); digest.update(path.read_bytes())
    for path in sorted((ROOT / "leaderboard").rglob("*")):
        if path.is_file():
            digest.update(path.relative_to(ROOT).as_posix().encode()); digest.update(b"\0"); digest.update(path.read_bytes())
    build = digest.hexdigest()[:16]
    (PUBLIC / "site-version.json").write_text(json.dumps({"name": "The Golden Moebius", "version": VERSION, "build": build}, indent=2) + "\n")
    public_files = [(path.relative_to(PUBLIC).as_posix(), path.read_bytes()) for path in sorted(PUBLIC.rglob("*")) if path.is_file()]
    payload_files = [("public/" + name, data) for name, data in public_files]
    for path in sorted((ROOT / "leaderboard").rglob("*")):
        if path.is_file():
            payload_files.append((path.relative_to(ROOT).as_posix(), path.read_bytes()))
    manifest = {name: hashlib.sha256(data).hexdigest() for name, data in payload_files}
    payload_files.append(("manifest-sha256.json", (json.dumps(manifest, indent=2) + "\n").encode()))
    write_archive(ROOT / "site.tar.gz", payload_files)
    deliverables = ["README.md", "Deploy.ps1", "build-package.py", "package.json", "package-lock.json", "tailwind.config.cjs", "site.tar.gz"]
    source_files = [(name, (ROOT / name).read_bytes()) for name in deliverables]
    for folder in ["dist", "src", "leaderboard", "deploy", "checks", "docs"]:
        for path in sorted((ROOT / folder).rglob("*")):
            if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc":
                source_files.append((path.relative_to(ROOT).as_posix(), path.read_bytes()))
    output = ROOT / (PROJECT_NAME + "-" + VERSION + ".tar.gz")
    write_archive(output, source_files, PROJECT_NAME + "/")
    print(f"Build {build}: {len(public_files)} public files.")
    print(f"Created {ROOT / 'site.tar.gz'}")
    print(f"Created {output} ({output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
