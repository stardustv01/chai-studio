from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SHEET_DIR = ROOT / "sheets" / "transparent"
OUTPUT_DIR = ROOT / "proof"
SHEETS = sorted(SHEET_DIR.glob("*.png"))

canvas_width = 1600
margin = 40
gap = 24
column_width = (canvas_width - margin * 2 - gap) // 2
image_width = column_width
image_height = round(image_width * 979 / 1606)
label_height = 34
row_height = label_height + image_height + gap
rows = (len(SHEETS) + 1) // 2
canvas_height = margin + 70 + rows * row_height

canvas = Image.new("RGB", (canvas_width, canvas_height), "#070A12")
draw = ImageDraw.Draw(canvas)
try:
    title_font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 28)
    label_font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 16)
except OSError:
    title_font = ImageFont.load_default()
    label_font = ImageFont.load_default()

draw.text((margin, margin), "CHAI STUDIO — IMAGEN ICON SYSTEM V2 / 123 ICONS", fill="#F5EFE2", font=title_font)

for index, sheet_path in enumerate(SHEETS):
    row, column = divmod(index, 2)
    x = margin + column * (column_width + gap)
    y = margin + 70 + row * row_height
    label = sheet_path.stem.replace("-", " ").upper()
    draw.text((x, y), label, fill="#19D9EA", font=label_font)
    sheet = Image.open(sheet_path).convert("RGBA")
    sheet.thumbnail((image_width, image_height), Image.Resampling.LANCZOS)
    panel = Image.new("RGBA", (image_width, image_height), "#0A0F19")
    panel.alpha_composite(sheet, ((image_width - sheet.width) // 2, (image_height - sheet.height) // 2))
    canvas.paste(panel.convert("RGB"), (x, y + label_height))

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
target = OUTPUT_DIR / "all-sheets-overview.png"
canvas.save(target, optimize=True)
print(f"Wrote {target}")
