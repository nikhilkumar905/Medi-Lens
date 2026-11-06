"""OCR with OpenCV preprocessing and Tesseract (via pytesseract).

Tesseract is an external binary. If it is not installed, `ocr_available()` returns
False and callers must surface a clear warning instead of pretending OCR happened.
"""
import os
import shutil
from functools import lru_cache

import cv2
import numpy as np

from app.core.config import get_settings


@lru_cache
def _tesseract_path() -> str | None:
    s = get_settings()
    candidates = [s.tesseract_cmd, shutil.which("tesseract"),
                  r"C:\Program Files\Tesseract-OCR\tesseract.exe",
                  r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"]
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return None


def ocr_available() -> bool:
    if not _tesseract_path():
        return False
    try:
        import pytesseract  # noqa: F401
        return True
    except ImportError:
        return False


def preprocess(img_bgr: np.ndarray) -> np.ndarray:
    """Grayscale -> denoise -> deskew -> Otsu binarisation."""
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY) if img_bgr.ndim == 3 else img_bgr
    gray = cv2.fastNlMeansDenoising(gray, h=10)
    # deskew using minimum-area rectangle of dark pixels
    inv = cv2.bitwise_not(gray)
    thresh = cv2.threshold(inv, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(thresh > 0))
    if len(coords) > 100:
        angle = cv2.minAreaRect(coords)[-1]
        angle = -(90 + angle) if angle < -45 else -angle
        if angle > 45:
            angle -= 90
        if 0.3 < abs(angle) < 15:
            h, w = gray.shape
            m = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
            gray = cv2.warpAffine(gray, m, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    return cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)[1]


def ocr_image(img_bgr: np.ndarray) -> list[dict]:
    """Return OCR words: [{text, conf, x0, y0, x1, y1}] in pixel coordinates."""
    import pytesseract
    from pytesseract import Output

    pytesseract.pytesseract.tesseract_cmd = _tesseract_path()
    proc = preprocess(img_bgr)
    data = pytesseract.image_to_data(proc, output_type=Output.DICT, config="--oem 3 --psm 6")
    words = []
    for i, txt in enumerate(data["text"]):
        txt = (txt or "").strip()
        if not txt:
            continue
        conf = float(data["conf"][i])
        x, y, w, h = data["left"][i], data["top"][i], data["width"][i], data["height"][i]
        words.append({"text": txt, "conf": conf, "x0": x, "y0": y, "x1": x + w, "y1": y + h})
    return words
