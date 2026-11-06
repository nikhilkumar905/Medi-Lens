"""DICOM metadata extraction and windowed slice rendering (pydicom)."""
import io

import numpy as np
import pydicom
from PIL import Image

SAFE_TAGS = ["Modality", "StudyDescription", "SeriesDescription", "BodyPartExamined", "StudyDate",
             "Manufacturer", "Rows", "Columns", "PixelSpacing", "SliceThickness", "ImageOrientationPatient",
             "ImagePositionPatient", "WindowCenter", "WindowWidth", "PhotometricInterpretation",
             "NumberOfFrames", "StudyInstanceUID", "SeriesInstanceUID", "PatientAge", "PatientSex"]


def is_dicom(data: bytes) -> bool:
    return len(data) > 132 and data[128:132] == b"DICM"


def _val(v):
    if isinstance(v, pydicom.multival.MultiValue):
        return [float(x) if isinstance(x, (int, float, pydicom.valuerep.DSfloat, pydicom.valuerep.IS)) else str(x) for x in v]
    if isinstance(v, (pydicom.valuerep.DSfloat, pydicom.valuerep.IS)):
        return float(v)
    return v if isinstance(v, (int, float)) else str(v)


def read_metadata(data: bytes) -> dict:
    ds = pydicom.dcmread(io.BytesIO(data), stop_before_pixels=True, force=True)
    meta = {t: _val(ds.get(t)) for t in SAFE_TAGS if ds.get(t) is not None}
    meta["frames"] = int(ds.get("NumberOfFrames", 1) or 1)
    return meta


def _first(v, default):
    if v is None:
        return default
    if isinstance(v, (list, pydicom.multival.MultiValue)):
        return float(v[0])
    return float(v)


def render_frame(data: bytes, frame: int = 0, center: float | None = None, width: float | None = None) -> bytes:
    ds = pydicom.dcmread(io.BytesIO(data), force=True)
    arr = ds.pixel_array.astype(np.float32)
    frames = int(ds.get("NumberOfFrames", 1) or 1)
    if frames > 1 or (arr.ndim == 3 and arr.shape[-1] not in (3, 4)):
        frame = max(0, min(frame, arr.shape[0] - 1))
        arr = arr[frame]
    arr = arr * float(ds.get("RescaleSlope", 1) or 1) + float(ds.get("RescaleIntercept", 0) or 0)
    if arr.ndim == 2:
        c = center if center is not None else _first(ds.get("WindowCenter"), float((arr.max() + arr.min()) / 2))
        w = width if width is not None else _first(ds.get("WindowWidth"), float(arr.max() - arr.min()) or 1.0)
        lo, hi = c - w / 2, c + w / 2
        img = np.clip((arr - lo) / max(hi - lo, 1e-6), 0, 1) * 255
        if ds.get("PhotometricInterpretation") == "MONOCHROME1":
            img = 255 - img
        pil = Image.fromarray(img.astype(np.uint8), "L")
    else:
        pil = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    buf = io.BytesIO()
    pil.save(buf, "PNG")
    return buf.getvalue()
