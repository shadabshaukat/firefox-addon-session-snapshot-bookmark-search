#!/usr/bin/env python3
"""Dependency-free validation for the AMO-ready Firefox WebExtension package."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def load_json(relative_path: str, errors: list[str]) -> dict:
    path = ROOT / relative_path
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        errors.append(f"Missing required JSON file: {relative_path}")
    except json.JSONDecodeError as exc:
        errors.append(f"Invalid JSON in {relative_path}: {exc}")
    return {}


def check_file(relative_path: str, errors: list[str]) -> Path:
    path = ROOT / relative_path
    if not path.is_file():
        errors.append(f"Missing required file: {relative_path}")
    return path


def validate_project() -> list[str]:
    errors: list[str] = []
    manifest = load_json("manifest.json", errors)
    package = load_json("package.json", errors)

    if manifest.get("manifest_version") != 2:
        errors.append("Firefox AMO package currently expects manifest_version 2 for this extension.")

    for key in ("name", "version", "description", "permissions", "browser_action", "icons", "browser_specific_settings"):
        if key not in manifest:
            errors.append(f"manifest.json missing required key: {key}")

    description = manifest.get("description", "")
    if len(description) > 132:
        errors.append("manifest description should be 132 characters or fewer for store compatibility.")

    version = manifest.get("version", "")
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:\.\d+)?", version):
        errors.append("manifest version must be a Firefox-compatible numeric dotted version, e.g. 0.1.0")
    if package and package.get("version") != version:
        errors.append("package.json version must match manifest.json version.")

    gecko = manifest.get("browser_specific_settings", {}).get("gecko", {})
    if not gecko.get("id"):
        errors.append("browser_specific_settings.gecko.id must be set before publishing so updates stay stable.")

    data_collection_permissions = gecko.get("data_collection_permissions")
    if not isinstance(data_collection_permissions, dict):
        errors.append("browser_specific_settings.gecko.data_collection_permissions is required by AMO.")
    else:
        required_data = data_collection_permissions.get("required")
        optional_data = data_collection_permissions.get("optional", [])
        if not isinstance(required_data, list) or not required_data:
            errors.append("data_collection_permissions.required must be a non-empty list.")
        if "none" in required_data and len(required_data) != 1:
            errors.append("data_collection_permissions.required must contain only 'none' when no data is collected.")
        if optional_data and not isinstance(optional_data, list):
            errors.append("data_collection_permissions.optional must be a list if provided.")

    popup = manifest.get("browser_action", {}).get("default_popup")
    if popup:
        check_file(popup, errors)
    else:
        errors.append("browser_action.default_popup is required.")

    for size, icon_path in manifest.get("icons", {}).items():
        path = check_file(icon_path, errors)
        if path.exists() and path.read_bytes()[:8] != PNG_SIGNATURE:
            errors.append(f"Icon {size} at {icon_path} is not a PNG file.")

    for size, icon_path in manifest.get("browser_action", {}).get("default_icon", {}).items():
        check_file(icon_path, errors)

    for required in ("README.md", "LICENSE", "PRIVACY_POLICY.md", "PERMISSIONS.md", "src/core.js", "src/popup.js", "src/popup.html", "src/popup.css"):
        check_file(required, errors)

    source_text = "\n".join(path.read_text(encoding="utf-8", errors="replace") for path in (ROOT / "src").glob("**/*") if path.is_file())
    banned_patterns = {
        "eval usage": r"\beval\s*\(",
        "new Function usage": r"\bnew\s+Function\s*\(",
        "remote script tag": r"<script[^>]+src=[\"'](?:https?:)?//",
        "remote stylesheet": r"<link[^>]+href=[\"'](?:https?:)?//"
    }
    for label, pattern in banned_patterns.items():
        if re.search(pattern, source_text, flags=re.IGNORECASE):
            errors.append(f"Source contains disallowed pattern for AMO review: {label}")

    return errors


def main() -> int:
    errors = validate_project()
    if errors:
        print("Validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("Validation passed: manifest, icons, docs, and source package checks are OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
