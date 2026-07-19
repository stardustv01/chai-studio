from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "icons" / "transparent-384"
OUTPUT = ROOT / "icons" / "light-384"

INK = (22, 26, 34)
SUCCESS = (20, 122, 70)


def is_ivory(red: int, green: int, blue: int) -> bool:
    return (
        red > 180
        and green > 175
        and blue > 155
        and max(red, green, blue) - min(red, green, blue) < 55
    )


def is_cyan(red: int, green: int, blue: int) -> bool:
    return red < 95 and green > 135 and blue > 150 and blue >= green - 35


OUTPUT.mkdir(parents=True, exist_ok=True)
for source_path in sorted(SOURCE.glob("*.png")):
    image = Image.open(source_path).convert("RGBA")
    pixels = []
    for red, green, blue, alpha in image.get_flattened_data():
        if alpha and is_ivory(red, green, blue):
            red, green, blue = INK
        elif source_path.stem == "status-ready" and alpha and is_cyan(red, green, blue):
            red, green, blue = SUCCESS
        pixels.append((red, green, blue, alpha))
    image.putdata(pixels)
    image.save(OUTPUT / source_path.name, optimize=True)

print(f"PASS: wrote {len(list(OUTPUT.glob('*.png')))} light-surface icon variants to {OUTPUT}")
