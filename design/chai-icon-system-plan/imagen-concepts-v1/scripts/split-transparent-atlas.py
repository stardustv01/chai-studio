from pathlib import Path
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "master-atlas-transparent-v1.png"
OUTPUT = ROOT / "transparent-samples-v1"
NAMES = [
    "workspace-edit",
    "folder-media",
    "curve-editor",
    "capture-exact",
    "render-file",
    "play",
    "blade-tool",
    "snap",
    "keyframe",
    "waveform",
    "captions",
    "search",
    "timeline-marker",
    "color-tool",
    "review-comment",
    "visibility",
    "qa-scan",
    "approve",
    "deliver-output",
    "render-queue",
    "project-folder",
    "microphone",
    "composition-layers",
    "status-warning",
]


def occupied_bands(mask: Image.Image, axis: str) -> list[tuple[int, int]]:
    width, height = mask.size
    occupied = []
    limit = width if axis == "x" else height
    for index in range(limit):
        box = (index, 0, index + 1, height) if axis == "x" else (0, index, width, index + 1)
        occupied.append(mask.crop(box).getbbox() is not None)

    bands = []
    start = None
    for index, active in enumerate(occupied + [False]):
        if active and start is None:
            start = index
        elif not active and start is not None:
            bands.append((start, index - 1))
            start = None
    return bands


def cell_bounds(bands: list[tuple[int, int]], limit: int) -> list[tuple[int, int]]:
    edges = [0]
    for current, following in zip(bands, bands[1:]):
        edges.append((current[1] + following[0]) // 2)
    edges.append(limit)
    return list(zip(edges, edges[1:]))


image = Image.open(SOURCE).convert("RGBA")
alpha = image.getchannel("A").point(lambda value: 255 if value > 16 else 0)
columns = occupied_bands(alpha, "x")
rows = occupied_bands(alpha, "y")

if len(columns) != 6 or len(rows) != 4:
    raise SystemExit(f"Expected a 6x4 atlas, detected {len(columns)}x{len(rows)}")

x_cells = cell_bounds(columns, image.width)
y_cells = cell_bounds(rows, image.height)
OUTPUT.mkdir(parents=True, exist_ok=True)

for index, name in enumerate(NAMES):
    row, column = divmod(index, 6)
    left, right = x_cells[column]
    top, bottom = y_cells[row]
    crop = image.crop((left, top, right, bottom))
    crop_alpha = crop.getchannel("A").point(lambda value: 255 if value > 8 else 0)
    bounds = crop_alpha.getbbox()
    if bounds is None:
        raise SystemExit(f"No visible pixels found for {name}")

    glyph = crop.crop(bounds)
    available = 208
    scale = min(available / glyph.width, available / glyph.height)
    resized = glyph.resize(
        (max(1, round(glyph.width * scale)), max(1, round(glyph.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    position = ((256 - resized.width) // 2, (256 - resized.height) // 2)
    canvas.alpha_composite(resized, position)
    canvas.save(OUTPUT / f"{name}.png", optimize=True)

print(f"Wrote {len(NAMES)} transparent 256x256 PNG samples to {OUTPUT}")
