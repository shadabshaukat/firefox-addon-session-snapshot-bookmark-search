#!/usr/bin/env python3
"""Create an AMO uploadable ZIP with extension files at the archive root."""
from __future__ import annotations

import json
import zipfile
from pathlib import Path

from validate import validate_project

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
INCLUDE_FILES = [
    "manifest.json",
    "README.md",
    "LICENSE",
    "PRIVACY_POLICY.md",
    "PERMISSIONS.md"
]
INCLUDE_DIRS = ["src", "assets"]


def iter_package_files() -> list[Path]:
    files: list[Path] = []
    for relative in INCLUDE_FILES:
        files.append(ROOT / relative)
    for directory in INCLUDE_DIRS:
        files.extend(path for path in (ROOT / directory).rglob("*") if path.is_file())
    return sorted(files, key=lambda path: path.relative_to(ROOT).as_posix())


def main() -> int:
    errors = validate_project()
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    slug = "session-snapshots-bookmark-search"
    version = manifest["version"]
    DIST.mkdir(exist_ok=True)
    output = DIST / f"{slug}-{version}.zip"
    if output.exists():
        output.unlink()

    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in iter_package_files():
            archive.write(path, path.relative_to(ROOT).as_posix())

    print(f"Created {output.relative_to(ROOT)}")
    print("Package contents:")
    with zipfile.ZipFile(output) as archive:
        for name in archive.namelist():
            print(f"- {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
