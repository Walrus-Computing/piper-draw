"""Generate the piper-draw README logo as an SVG.

Renders "PIPER DRAW" as a pipe-diagram wordmark. Each filled cell of a
5x5 pixel-font letter becomes a small cube; orthogonally adjacent filled
cells get a pipe connector drawn between them. Colors come from the
app's X/Z/Y basis palette and cycle per letter. Output is written to
``assets/logo.svg``.
"""

from pathlib import Path

LETTERS = {
    "P": [
        "11110",
        "10010",
        "11110",
        "10000",
        "10000",
    ],
    "I": [
        "11111",
        "00100",
        "00100",
        "00100",
        "11111",
    ],
    "E": [
        "11111",
        "10000",
        "11110",
        "10000",
        "11111",
    ],
    "R": [
        "11110",
        "10010",
        "11110",
        "10010",
        "10011",
    ],
    "D": [
        "11110",
        "10010",
        "10010",
        "10010",
        "11110",
    ],
    "A": [
        "01110",
        "10001",
        "11111",
        "10001",
        "10001",
    ],
    "W": [
        "10001",
        "10001",
        "10101",
        "10101",
        "01010",
    ],
}

# Basis colors from the app's palette (X=red, Z=blue, Y=green).
X_RED = "#ff7f7f"
Z_BLUE = "#7396ff"
Y_GREEN = "#63c676"

CUBE_STROKES = {
    X_RED: "#c45959",
    Z_BLUE: "#4b6acc",
    Y_GREEN: "#3e8d4d",
}

PIPE_FILLS = {
    X_RED: "#ffb3b3",
    Z_BLUE: "#aabcff",
    Y_GREEN: "#9adba5",
}

WORD = "PIPER DRAW"
PALETTE = [Z_BLUE, X_RED, Y_GREEN]

CELL = 24              # grid cell size
CUBE_PAD = 4           # inset from cell edge to cube
CUBE_SIZE = CELL - 2 * CUBE_PAD  # 16
PIPE_THICK = 8         # pipe width along minor axis
PIPE_LEN = 2 * CUBE_PAD  # pipe length along major axis (fills gap)
PIPE_OFFSET = (CELL - PIPE_THICK) // 2  # 8

LETTER_W = 5 * CELL
LETTER_H = 5 * CELL
LETTER_GAP = CELL
WORD_GAP = 3 * CELL
PAD = CELL


def total_width() -> int:
    width = PAD
    for i, ch in enumerate(WORD):
        if ch == " ":
            width += WORD_GAP
            continue
        width += LETTER_W
        if i + 1 < len(WORD) and WORD[i + 1] != " ":
            width += LETTER_GAP
    width += PAD
    return width


def render_letter(grid: list[str], x0: int, y0: int, color: str) -> list[str]:
    stroke = CUBE_STROKES[color]
    pipe_fill = PIPE_FILLS[color]
    parts: list[str] = []

    def is_filled(r: int, c: int) -> bool:
        return 0 <= r < 5 and 0 <= c < 5 and grid[r][c] == "1"

    # Draw pipes first so cubes sit on top.
    for r in range(5):
        for c in range(5):
            if not is_filled(r, c):
                continue
            # Horizontal pipe to right neighbor.
            if is_filled(r, c + 1):
                px = x0 + c * CELL + CELL - CUBE_PAD
                py = y0 + r * CELL + PIPE_OFFSET
                parts.append(
                    f'    <rect x="{px}" y="{py}" '
                    f'width="{PIPE_LEN}" height="{PIPE_THICK}" '
                    f'fill="{pipe_fill}" stroke="{stroke}" '
                    f'stroke-width="1" shape-rendering="crispEdges" />'
                )
            # Vertical pipe to below neighbor.
            if is_filled(r + 1, c):
                px = x0 + c * CELL + PIPE_OFFSET
                py = y0 + r * CELL + CELL - CUBE_PAD
                parts.append(
                    f'    <rect x="{px}" y="{py}" '
                    f'width="{PIPE_THICK}" height="{PIPE_LEN}" '
                    f'fill="{pipe_fill}" stroke="{stroke}" '
                    f'stroke-width="1" shape-rendering="crispEdges" />'
                )

    # Draw cubes on top.
    for r in range(5):
        for c in range(5):
            if not is_filled(r, c):
                continue
            cx = x0 + c * CELL + CUBE_PAD
            cy = y0 + r * CELL + CUBE_PAD
            parts.append(
                f'    <rect x="{cx}" y="{cy}" '
                f'width="{CUBE_SIZE}" height="{CUBE_SIZE}" '
                f'fill="{color}" stroke="{stroke}" '
                f'stroke-width="1.5" shape-rendering="crispEdges" />'
            )

    return parts


def build_svg() -> str:
    w = total_width()
    h = PAD * 2 + LETTER_H

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
        f'role="img" aria-label="piper-draw">',
        "  <title>piper-draw</title>",
    ]

    letter_idx = 0
    x = PAD
    y = PAD
    for ch in WORD:
        if ch == " ":
            x += WORD_GAP
            continue
        color = PALETTE[letter_idx % len(PALETTE)]
        parts.append(f'  <g data-letter="{ch}">')
        parts.extend(render_letter(LETTERS[ch], x, y, color))
        parts.append("  </g>")
        x += LETTER_W + LETTER_GAP
        letter_idx += 1

    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    out_path = repo_root / "assets" / "logo.svg"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(build_svg())
    print(f"wrote {out_path.relative_to(repo_root)}")


if __name__ == "__main__":
    main()
