"""Document text extraction pipeline.

PDF:  native PyMuPDF text -> quality inspection -> (if unreliable) 300 DPI render
      -> OpenCV preprocessing -> Tesseract OCR. OCR runs per page only when needed.
DOCX: python-docx paragraphs and tables.
TXT:  decoded text.
Images: OCR.

Every page is returned as a list of *lines*; each line keeps its *cells* (column
segments separated by large horizontal gaps) and a normalised bounding box so the UI
can highlight the source location of an extracted value.
"""
import io
from dataclasses import dataclass

import cv2
import pymupdf as fitz  # PyMuPDF
import numpy as np

from app.services.ocr.engine import ocr_available, ocr_image

from .text_quality import inspect_text

OCR_DPI = 300
LOW_CONF = 60.0


@dataclass
class Word:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    conf: float = 100.0


def _group_lines(words: list[Word], width: float, height: float) -> list[dict]:
    """Cluster words into lines by vertical overlap, then split lines into cells."""
    if not words:
        return []
    words = sorted(words, key=lambda w: ((w.y0 + w.y1) / 2, w.x0))
    lines: list[list[Word]] = []
    for w in words:
        mid = (w.y0 + w.y1) / 2
        placed = False
        for line in reversed(lines[-3:]):
            ly0 = min(x.y0 for x in line)
            ly1 = max(x.y1 for x in line)
            if ly0 - 1 <= mid <= ly1 + 1:
                line.append(w)
                placed = True
                break
        if not placed:
            lines.append([w])

    out = []
    for line in lines:
        line.sort(key=lambda w: w.x0)
        heights = [w.y1 - w.y0 for w in line]
        gap_threshold = max(8.0, 1.2 * (sum(heights) / len(heights)))
        cells: list[list[Word]] = [[line[0]]]
        for prev, cur in zip(line, line[1:]):
            if cur.x0 - prev.x1 > gap_threshold:
                cells.append([cur])
            else:
                cells[-1].append(cur)

        def box(ws: list[Word]) -> list[float]:
            return [round(min(w.x0 for w in ws) / width, 4), round(min(w.y0 for w in ws) / height, 4),
                    round(max(w.x1 for w in ws) / width, 4), round(max(w.y1 for w in ws) / height, 4)]

        cell_objs = [{"text": " ".join(w.text for w in c), "bbox": box(c),
                      "low_confidence": any(w.conf < LOW_CONF for w in c)} for c in cells]
        out.append({
            "text": "  ".join(c["text"] for c in cell_objs),
            "cells": cell_objs,
            "bbox": box(line),
            "low_confidence": any(c["low_confidence"] for c in cell_objs),
        })
    out.sort(key=lambda ln: (ln["bbox"][1], ln["bbox"][0]))
    return out


def _render_page(page: fitz.Page, dpi: int = OCR_DPI) -> np.ndarray:
    pix = page.get_pixmap(dpi=dpi, colorspace=fitz.csRGB)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def _ocr_lines(img: np.ndarray) -> list[dict]:
    h, w = img.shape[:2]
    words = [Word(d["text"], d["x0"], d["y0"], d["x1"], d["y1"], d["conf"]) for d in ocr_image(img)]
    return _group_lines(words, w, h)


def _font_warnings(page: fitz.Page) -> list[str]:
    warnings = []
    for f in page.get_fonts(full=True):
        # (xref, ext, type, basefont, name, encoding, referencer)
        ftype, basefont, enc = f[2], f[3], f[5]
        if ftype == "Type3":
            warnings.append(f"Type3 font '{basefont}' (glyph shapes may not map to Unicode)")
        elif enc and enc not in ("WinAnsiEncoding", "MacRomanEncoding", "Identity-H", "Identity-V",
                                 "StandardEncoding", "") and "Custom" in enc:
            warnings.append(f"Custom font encoding '{enc}' in '{basefont}'")
    return warnings


def extract_pdf(data: bytes, force_ocr: bool = False) -> dict:
    doc = fitz.open(stream=data, filetype="pdf")
    pages = []
    for i, page in enumerate(doc):
        w, h = page.rect.width, page.rect.height
        native_words = [Word(t[4], t[0], t[1], t[2], t[3]) for t in page.get_text("words")]
        native_text = page.get_text("text")
        quality = inspect_text(native_text)
        images = page.get_images(full=True)
        image_cover = 0.0
        for img in images:
            for r in page.get_image_rects(img[0]):
                image_cover += (r.width * r.height) / (w * h)
        warnings = _font_warnings(page)
        if image_cover > 0.5:
            warnings.append(f"Page is {min(image_cover, 1):.0%} covered by images (possibly scanned)")

        needs_ocr = force_ocr or not quality.reliable
        method = "native"
        lines = _group_lines(native_words, w, h)
        if needs_ocr:
            if ocr_available():
                lines = _ocr_lines(_render_page(page))
                method = f"ocr-tesseract@{OCR_DPI}dpi"
                if not quality.reliable:
                    warnings.append("Native text unreliable — OCR fallback used")
            else:
                method = "native-unreliable"
                warnings.append(
                    "Native text appears unreliable but no OCR engine is installed "
                    "(install Tesseract). Values on this page require manual verification."
                )
                for ln in lines:
                    ln["low_confidence"] = True
        pages.append({
            "page": i + 1,
            "method": method,
            "quality": quality.as_dict(),
            "warnings": warnings,
            "lines": lines,
            "text": "\n".join(ln["text"] for ln in lines),
            "size": [w, h],
        })
    doc.close()
    return {"kind": "pdf", "pages": pages}


def extract_image(data: bytes) -> dict:
    arr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if arr is None:
        raise ValueError("File is not a decodable image")
    h, w = arr.shape[:2]
    if not ocr_available():
        return {"kind": "image", "pages": [{
            "page": 1, "method": "none", "quality": None, "lines": [], "text": "", "size": [w, h],
            "warnings": ["No OCR engine installed (install Tesseract) — image text cannot be read."],
        }]}
    lines = _ocr_lines(arr)
    return {"kind": "image", "pages": [{
        "page": 1, "method": "ocr-tesseract", "quality": inspect_text("\n".join(l["text"] for l in lines)).as_dict(),
        "warnings": [], "lines": lines, "text": "\n".join(l["text"] for l in lines), "size": [w, h],
    }]}


def extract_docx(data: bytes) -> dict:
    import docx

    d = docx.Document(io.BytesIO(data))
    lines = [{"text": p.text, "cells": [{"text": p.text, "bbox": None, "low_confidence": False}],
              "bbox": None, "low_confidence": False} for p in d.paragraphs if p.text.strip()]
    for table in d.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells]
            # merged cells repeat; de-duplicate consecutive repeats
            dedup = [c for j, c in enumerate(cells) if j == 0 or c != cells[j - 1]]
            lines.append({"text": "  ".join(dedup),
                          "cells": [{"text": c, "bbox": None, "low_confidence": False} for c in dedup],
                          "bbox": None, "low_confidence": False})
    text = "\n".join(l["text"] for l in lines)
    return {"kind": "docx", "pages": [{"page": 1, "method": "docx", "quality": inspect_text(text).as_dict(),
                                       "warnings": [], "lines": lines, "text": text, "size": None}]}


def extract_txt(data: bytes) -> dict:
    for enc in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            text = data.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    lines = []
    for raw in text.splitlines():
        if not raw.strip():
            continue
        parts = [p.strip() for p in __import__("re").split(r"\t| {2,}", raw.strip()) if p.strip()]
        lines.append({"text": "  ".join(parts),
                      "cells": [{"text": p, "bbox": None, "low_confidence": False} for p in parts],
                      "bbox": None, "low_confidence": False})
    return {"kind": "txt", "pages": [{"page": 1, "method": "text", "quality": inspect_text(text).as_dict(),
                                      "warnings": [], "lines": lines, "text": text, "size": None}]}


def render_pdf_page_png(data: bytes, page_no: int, dpi: int = 110) -> bytes:
    doc = fitz.open(stream=data, filetype="pdf")
    if not 1 <= page_no <= len(doc):
        raise ValueError("Page out of range")
    png = doc[page_no - 1].get_pixmap(dpi=dpi).tobytes("png")
    doc.close()
    return png
