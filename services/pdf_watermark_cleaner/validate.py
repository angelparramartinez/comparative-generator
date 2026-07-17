import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from watermark import detect_watermark_candidates, strip_watermark
import pikepdf

EXAMPLES_DIR = Path(__file__).parent.parent.parent / "examples"

FILES = [
    "condicionado general occident.pdf",
    "condiciones generales Generali Hogar.pdf",
    "condicionado general Axa hogar.pdf",
    "condicionado general allianz.pdf",
    "Condicionado general santalucia.pdf",
]


def main():
    for fname in FILES:
        path = EXAMPLES_DIR / fname
        pdf = pikepdf.open(path)

        watermark_texts, median_size = detect_watermark_candidates(pdf)

        print(f"=== {fname} ===")
        print(f"  median font size: {median_size}")
        print(f"  watermark texts detected: {sorted(watermark_texts)}")

        if watermark_texts:
            input_bytes = path.read_bytes()
            output_bytes, stats = strip_watermark(input_bytes)
            print(f"  removed operators: {stats['removed_operators']}")
            print(f"  output size: {len(output_bytes)} bytes (input was {len(input_bytes)})")
        else:
            print("  no watermark detected -- document left untouched (expected for most companies)")

        print()


if __name__ == "__main__":
    main()
