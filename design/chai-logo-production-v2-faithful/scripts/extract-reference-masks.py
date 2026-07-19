from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ROOT.parent / "brand-concepts-v4"
MASK_ROOT = ROOT / "work" / "masks"
PROOF_ROOT = ROOT / "proof"


def save_mask(mask: np.ndarray, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pixels = np.where(mask, 0, 255).astype(np.uint8)
    Image.fromarray(pixels).save(path)


def remove_small_components(mask: np.ndarray, minimum: int) -> np.ndarray:
    height, width = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    output = mask.copy()
    for start_y in range(height):
        for start_x in range(width):
            if not mask[start_y, start_x] or seen[start_y, start_x]:
                continue
            stack = [(start_y, start_x)]
            seen[start_y, start_x] = True
            component: list[tuple[int, int]] = []
            while stack:
                y, x = stack.pop()
                component.append((y, x))
                for next_y, next_x in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if (
                        0 <= next_y < height
                        and 0 <= next_x < width
                        and mask[next_y, next_x]
                        and not seen[next_y, next_x]
                    ):
                        seen[next_y, next_x] = True
                        stack.append((next_y, next_x))
            if len(component) < minimum:
                for y, x in component:
                    output[y, x] = False
    return output


def fill_small_holes(mask: np.ndarray, maximum: int) -> np.ndarray:
    height, width = mask.shape
    empty = ~mask
    seen = np.zeros_like(mask, dtype=bool)
    output = mask.copy()
    for start_y in range(height):
        for start_x in range(width):
            if not empty[start_y, start_x] or seen[start_y, start_x]:
                continue
            stack = [(start_y, start_x)]
            seen[start_y, start_x] = True
            component: list[tuple[int, int]] = []
            touches_edge = False
            while stack:
                y, x = stack.pop()
                component.append((y, x))
                touches_edge = touches_edge or y in (0, height - 1) or x in (0, width - 1)
                for next_y, next_x in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if (
                        0 <= next_y < height
                        and 0 <= next_x < width
                        and empty[next_y, next_x]
                        and not seen[next_y, next_x]
                    ):
                        seen[next_y, next_x] = True
                        stack.append((next_y, next_x))
            if not touches_edge and len(component) <= maximum:
                for y, x in component:
                    output[y, x] = True
    return output


def clean(mask: np.ndarray, minimum: int = 28, maximum_hole: int = 90) -> np.ndarray:
    return fill_small_holes(remove_small_components(mask, minimum), maximum_hole)


def colour_masks(image: Image.Image) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rgb = np.asarray(image.convert("RGB"), dtype=np.int16)
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]

    ivory = (
        (red > 145)
        & (green > 135)
        & (blue > 118)
        & (np.abs(red - green) < 62)
        & (red > blue)
    )
    amber = (
        (red > 155)
        & (green > 70)
        & (green < 225)
        & (blue < 118)
        & (red > green * 1.16)
    )
    cyan = (
        (green > 105)
        & (blue > 115)
        & (red < 130)
        & (green > red * 1.45)
        & (blue > red * 1.45)
    )
    return ivory, amber, cyan


def main() -> None:
    MASK_ROOT.mkdir(parents=True, exist_ok=True)
    PROOF_ROOT.mkdir(parents=True, exist_ok=True)

    concept = Image.open(SOURCE_ROOT / "03-balanced-hybrid.png").convert("RGB")
    # Approved primary lockup only. Coordinates are frozen to the 1024x1536
    # concept canvas so all vector layers share one deterministic 600x360 box.
    primary = concept.crop((55, 130, 655, 490))
    primary.save(PROOF_ROOT / "approved-primary-reference.png")

    ivory, amber, cyan = colour_masks(primary)
    height, width = ivory.shape
    yy, xx = np.mgrid[0:height, 0:width]

    # Rebuild the editorial headline as the clean geometry the raster implies.
    # The concept pixels contain a cyan-cut gap and a small glyph overlap; the
    # approved motion board clearly specifies one uninterrupted line plus three
    # ticks before any letter body appears.
    timeline = np.zeros_like(ivory, dtype=bool)
    timeline[45:59, 25:572] = True
    timeline[36:67, 223:230] = True
    timeline[36:67, 329:336] = True
    timeline[36:67, 461:468] = True
    body = ivory & (yy >= 66) & (yy < 270)
    english = ivory & (yy >= 270)
    # The motion reference treats the compact `चा` construction as the first
    # subject. The `य` bowl is a separate semantic layer even though it crosses
    # behind the later cyan playhead.
    first = body & (xx < 305)
    rest = body & (xx >= 305)

    save_mask(clean(timeline, minimum=80), MASK_ROOT / "primary-timeline.png")
    save_mask(clean(first), MASK_ROOT / "primary-first.png")
    save_mask(clean(rest), MASK_ROOT / "primary-rest.png")
    save_mask(clean(english), MASK_ROOT / "primary-english.png")
    save_mask(clean(amber, minimum=18), MASK_ROOT / "primary-amber.png")
    save_mask(clean(cyan, minimum=18), MASK_ROOT / "primary-cyan.png")

    icon = Image.open(SOURCE_ROOT / "03-symbol-crop.png").convert("RGB")
    icon.save(PROOF_ROOT / "approved-symbol-reference.png")
    icon_ivory, icon_amber, icon_cyan = colour_masks(icon)
    save_mask(clean(icon_ivory), MASK_ROOT / "icon-ivory.png")
    save_mask(clean(icon_amber, minimum=18), MASK_ROOT / "icon-amber.png")
    save_mask(clean(icon_cyan, minimum=18), MASK_ROOT / "icon-cyan.png")


if __name__ == "__main__":
    main()
