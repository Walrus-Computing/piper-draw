"""Generate the piper-draw README logo as an SVG.

Renders "PIPER DRAW" as a pixel-art wordmark evoking a pipe-diagram
lattice. Each filled cell of a 5x5 pixel-font letter becomes a solid
colored cube. Colors come from the app's X/Z/Y basis palette and cycle
per letter. Output is written to ``assets/logo.svg``.
"""

from pathlib import Path

LETTERS = {
    "P": [
        "11110",
        "10001",
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
        "10001",
        "11110",
        "10010",
        "10001",
    ],
    "D": [
        "11110",
        "10001",
        "10001",
        "10001",
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

X_RED = "#ff7f7f"
Z_BLUE = "#7396ff"
Y_GREEN = "#63c676"

STROKES = {
    X_RED: "#c45959",
    Z_BLUE: "#4b6acc",
    Y_GREEN: "#3e8d4d",
}

WORD = "PIPER DRAW"
PALETTE = [Z_BLUE, X_RED, Y_GREEN]

CELL = 22
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
        stroke = STROKES[color]
        grid = LETTERS[ch]
        parts.append(f'  <g data-letter="{ch}">')
        for r, row in enumerate(grid):
            for c, bit in enumerate(row):
                if bit == "1":
                    cx = x + c * CELL
                    cy = y + r * CELL
                    parts.append(
                        f'    <rect x="{cx}" y="{cy}" '
                        f'width="{CELL}" height="{CELL}" '
                        f'fill="{color}" stroke="{stroke}" '
                        f'stroke-width="1.5" shape-rendering="crispEdges" />'
                    )
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
