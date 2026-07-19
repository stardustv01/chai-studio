import json
from pathlib import Path
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SHEETS = ROOT / "sheets" / "transparent"
OUTPUT = ROOT / "icons" / "transparent-384"
MANIFEST = json.loads((ROOT / "sheet-manifest.json").read_text())


OUTPUT.mkdir(parents=True, exist_ok=True)
all_names = []

for sheet in MANIFEST["sheets"]:
    image = Image.open(SHEETS / sheet["file"]).convert("RGBA")
    x_edges = [0.04, 0.28, 0.52, 0.76, 0.99]
    y_edges = [0.05, 0.35, 0.65, 0.95]

    for index, name in enumerate(sheet["icons"]):
        row, column = divmod(index, 4)
        crop = image.crop(
            (
                round(image.width * x_edges[column]),
                round(image.height * y_edges[row]),
                round(image.width * x_edges[column + 1]),
                round(image.height * y_edges[row + 1]),
            )
        )
        if crop.getchannel("A").point(lambda value: 255 if value > 16 else 0).getbbox() is None:
            raise SystemExit(f"{sheet['file']}: empty cell for {name}")
        alpha = crop.getchannel("A").point(lambda value: 255 if value > 16 else 0)
        bounds = alpha.getbbox()
        glyph = crop.crop(bounds)
        scale = min(304 / glyph.width, 304 / glyph.height)
        resized = glyph.resize(
            (round(glyph.width * scale), round(glyph.height * scale)),
            Image.Resampling.LANCZOS,
        )
        canvas = Image.new("RGBA", (384, 384), (0, 0, 0, 0))
        canvas.alpha_composite(
            resized,
            ((384 - resized.width) // 2, (384 - resized.height) // 2),
        )
        canvas.save(OUTPUT / f"{name}.png", optimize=True)
        all_names.append(name)

if len(all_names) != MANIFEST["total"]:
    raise SystemExit(f"Expected {MANIFEST['total']} icons, wrote {len(all_names)}")
if len(set(all_names)) != len(all_names):
    raise SystemExit("Duplicate icon names detected")

print(f"PASS: wrote {len(all_names)} unique transparent 384x384 icons to {OUTPUT}")
