import io
import math
from collections import Counter

import pikepdf
from pikepdf import parse_content_stream, unparse_content_stream

OUTLIER_MULTIPLIER = 3.0
MIN_PAGE_FRACTION = 0.3
MIN_OCCURRENCES = 3


def _matrix_scale(matrix):
    a, b, c, d = matrix[0], matrix[1], matrix[2], matrix[3]
    determinant = float(a) * float(d) - float(b) * float(c)
    return math.sqrt(abs(determinant)) if determinant else 1.0


def _text_operator_content(instr):
    opname = str(instr.operator)

    if opname == "Tj":
        return str(instr.operands[0])

    if opname == "TJ":
        return "".join(
            str(part) for part in instr.operands[0] if isinstance(part, (pikepdf.String, str))
        )

    return None


def _walk_page(page):
    """Yields (instr, text_or_None, effective_font_size_or_None) for every
    operator in the page's content stream, tracking font size and the
    uniform scale component of the current transformation matrix (rotation
    does not count as scale -- only the matrix determinant does)."""

    ops = parse_content_stream(page)

    ctm_stack = [1.0]
    current_scale = 1.0
    current_font_size = None

    for instr in ops:
        opname = str(instr.operator)

        if opname == "q":
            ctm_stack.append(current_scale)
        elif opname == "Q":
            if len(ctm_stack) > 1:
                ctm_stack.pop()
            current_scale = ctm_stack[-1]
        elif opname == "cm":
            current_scale = ctm_stack[-1] * _matrix_scale(instr.operands)
            ctm_stack[-1] = current_scale
        elif opname == "Tf":
            current_font_size = float(instr.operands[1])

        text = _text_operator_content(instr) if current_font_size is not None else None
        effective_size = current_font_size * current_scale if text is not None else None

        yield instr, text, effective_size


def detect_watermark_candidates(pdf):
    """Generic, content-agnostic watermark detector: flags text that (a) is
    drawn at a font size far above the document's own dominant body size,
    and (b) repeats verbatim across a large share of the document's pages.
    No literals of any specific company are hardcoded -- both conditions
    together are what make a real watermark/stamp distinguishable from a
    one-off large title or a small repeated running header."""

    per_text_sizes = {}
    per_text_pages = {}
    all_sizes = Counter()

    for page_index, page in enumerate(pdf.pages):
        try:
            walk = list(_walk_page(page))
        except Exception:
            continue

        for _instr, text, size in walk:
            if text is None:
                continue

            all_sizes[round(size, 2)] += 1

            key = text.strip()
            if not key:
                continue

            per_text_sizes.setdefault(key, []).append(size)
            per_text_pages.setdefault(key, set()).add(page_index)

    if not all_sizes:
        return set(), None

    sorted_sizes = sorted(all_sizes.elements())
    median_size = sorted_sizes[len(sorted_sizes) // 2]

    if median_size <= 0:
        return set(), median_size

    num_pages = len(pdf.pages)
    min_pages_required = max(MIN_OCCURRENCES, math.ceil(num_pages * MIN_PAGE_FRACTION))

    watermark_texts = set()
    for text, sizes in per_text_sizes.items():
        pages_hit = len(per_text_pages[text])
        avg_size = sum(sizes) / len(sizes)

        if avg_size >= OUTLIER_MULTIPLIER * median_size and pages_hit >= min_pages_required:
            watermark_texts.add(text)

    return watermark_texts, median_size


def strip_watermark(input_bytes):
    pdf = pikepdf.open(io.BytesIO(input_bytes))

    watermark_texts, median_size = detect_watermark_candidates(pdf)

    removed_count = 0

    if watermark_texts:
        for page in pdf.pages:
            try:
                walk = list(_walk_page(page))
            except Exception:
                continue

            kept = []
            for instr, text, size in walk:
                is_watermark = (
                    text is not None
                    and text.strip() in watermark_texts
                    and size >= OUTLIER_MULTIPLIER * median_size
                )

                if is_watermark:
                    removed_count += 1
                    continue

                kept.append(instr)

            page.Contents = pdf.make_stream(unparse_content_stream(kept))

    output = io.BytesIO()
    pdf.save(output)

    return output.getvalue(), {
        "watermark_texts": sorted(watermark_texts),
        "median_font_size": median_size,
        "removed_operators": removed_count,
    }
