#!/usr/bin/env python3
"""Build deterministic, UI-sized Chai icon assets from the locked Imagen masters."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = REPO_ROOT / "design/chai-icon-system-plan/imagen-system-v2"
OUTPUT_ROOT = REPO_ROOT / "apps/studio-web/public/icons/chai"
OUTPUT_SIZE = 96


def icon_names() -> list[str]:
    manifest = json.loads((SOURCE_ROOT / "sheet-manifest.json").read_text(encoding="utf-8"))
    return [name for sheet in manifest["sheets"] for name in sheet["icons"]]


def build_variant(source_folder: str, output_folder: str, names: list[str]) -> list[dict[str, object]]:
    source_root = SOURCE_ROOT / "icons" / source_folder
    output_root = OUTPUT_ROOT / output_folder
    output_root.mkdir(parents=True, exist_ok=True)
    records: list[dict[str, object]] = []

    for name in names:
        source = source_root / f"{name}.png"
        target = output_root / f"{name}.png"
        with Image.open(source) as image:
            rgba = image.convert("RGBA")
            resized = rgba.resize((OUTPUT_SIZE, OUTPUT_SIZE), Image.Resampling.LANCZOS)
            resized.save(target, format="PNG", optimize=True)
        with Image.open(target) as output:
            if output.mode != "RGBA" or output.size != (OUTPUT_SIZE, OUTPUT_SIZE):
                raise RuntimeError(f"Invalid production icon: {target}")
            alpha = output.getchannel("A")
            if alpha.getbbox() is None:
                raise RuntimeError(f"Empty production icon: {target}")
        records.append(
            {
                "name": name,
                "file": f"{output_folder}/{name}.png",
                "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
            }
        )
    return records


def verify(names: list[str]) -> None:
    expected = {f"{name}.png" for name in names}
    for variant in ("dark", "light"):
        actual = {path.name for path in (OUTPUT_ROOT / variant).glob("*.png")}
        if actual != expected:
            missing = sorted(expected - actual)
            extra = sorted(actual - expected)
            raise RuntimeError(f"{variant} icon set mismatch; missing={missing}, extra={extra}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Verify existing production assets only")
    args = parser.parse_args()
    names = icon_names()
    if len(names) != 123 or len(set(names)) != 123:
        raise RuntimeError("The locked source manifest must contain 123 unique icon names")

    if args.check:
        verify(names)
        return

    records = {
        "version": "2.0.0-production-1",
        "source": "design/chai-icon-system-plan/imagen-system-v2",
        "sourceManifestSha256": hashlib.sha256(
            (SOURCE_ROOT / "sheet-manifest.json").read_bytes()
        ).hexdigest(),
        "canvas": {"width": OUTPUT_SIZE, "height": OUTPUT_SIZE},
        "total": len(names),
        "variants": {
            "dark": build_variant("transparent-384", "dark", names),
            "light": build_variant("light-384", "light", names),
        },
    }
    (OUTPUT_ROOT / "manifest.json").write_text(
        json.dumps(records, indent=2) + "\n", encoding="utf-8"
    )
    verify(names)


if __name__ == "__main__":
    main()
