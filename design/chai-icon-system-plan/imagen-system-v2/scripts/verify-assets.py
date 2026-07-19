import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = json.loads((ROOT / "sheet-manifest.json").read_text())
SIZE_POLICY = json.loads((ROOT / "size-policy.json").read_text())
ICON_DIR = ROOT / "icons" / "transparent-384"
LIGHT_ICON_DIR = ROOT / "icons" / "light-384"
SHEET_DIR = ROOT / "sheets" / "transparent"

expected = [name for sheet in MANIFEST["sheets"] for name in sheet["icons"]]
actual = sorted(path.stem for path in ICON_DIR.glob("*.png"))
failures = []

if len(expected) != 123 or len(set(expected)) != 123:
    failures.append("manifest must contain 123 unique icon names")
if sorted(expected) != actual:
    failures.append("individual PNG filenames do not match the manifest")
if len(list(SHEET_DIR.glob("*.png"))) != 11:
    failures.append("expected 11 transparent source sheets")

light_actual = sorted(path.stem for path in LIGHT_ICON_DIR.glob("*.png"))
if sorted(expected) != light_actual:
    failures.append("light PNG filenames do not match the manifest")

micro14 = SIZE_POLICY.get("micro14Approved", [])
if len(micro14) != len(set(micro14)):
    failures.append("micro14Approved contains duplicate icon names")
unknown_micro14 = sorted(set(micro14) - set(expected))
if unknown_micro14:
    failures.append(
        "micro14Approved contains unknown icon names: " + ", ".join(unknown_micro14)
    )
if SIZE_POLICY.get("defaultMinimumSize") != 16:
    failures.append("defaultMinimumSize must remain 16 px for this candidate")
if SIZE_POLICY.get("minimumControlTarget") != 32:
    failures.append("minimumControlTarget must remain 32 px for this candidate")

for name in expected:
    path = ICON_DIR / f"{name}.png"
    image = Image.open(path)
    if image.mode != "RGBA":
        failures.append(f"{name}: expected RGBA, received {image.mode}")
        continue
    if image.size != (384, 384):
        failures.append(f"{name}: expected 384x384, received {image.size}")
    alpha = image.getchannel("A")
    if any(alpha.getpixel(point) != 0 for point in [(0, 0), (383, 0), (0, 383), (383, 383)]):
        failures.append(f"{name}: canvas corners are not transparent")
    visible = sum(1 for value in alpha.get_flattened_data() if value > 16)
    coverage = visible / (384 * 384)
    if not 0.015 <= coverage <= 0.65:
        failures.append(f"{name}: implausible visible coverage {coverage:.3f}")

    light_path = LIGHT_ICON_DIR / f"{name}.png"
    light_image = Image.open(light_path)
    if light_image.mode != "RGBA":
        failures.append(f"{name} light: expected RGBA, received {light_image.mode}")
    if light_image.size != (384, 384):
        failures.append(f"{name} light: expected 384x384, received {light_image.size}")

if failures:
    raise SystemExit("\n".join(failures))

print("PASS: 11 transparent sheets map to 123 unique icon names.")
print("PASS: every icon is 384x384 RGBA with transparent corners and plausible coverage.")
print("PASS: 123 light variants match the manifest and canvas contract.")
print(f"PASS: size policy references {len(micro14)} valid 14 px icons.")
