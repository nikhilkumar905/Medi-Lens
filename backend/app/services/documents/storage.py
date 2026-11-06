"""Encrypted file storage + upload content validation."""
import hashlib
import io
import uuid
import zipfile
from pathlib import Path

from app.core.config import get_settings
from app.core.security import decrypt_bytes, encrypt_bytes
from app.services.dicom.dicom_service import is_dicom

ALLOWED_EXT = {".pdf": "pdf", ".jpg": "image", ".jpeg": "image", ".png": "image", ".docx": "docx",
               ".txt": "txt", ".dcm": "dicom", ".dicom": "dicom"}
MIME = {"pdf": "application/pdf", "image": "image/*", "docx":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "txt": "text/plain",
        "dicom": "application/dicom"}


class UploadRejected(ValueError):
    pass


def detect_kind(filename: str, data: bytes) -> tuple[str, str]:
    """Validate that the file's *contents* match its extension. Returns (kind, mime)."""
    ext = Path(filename).suffix.lower()
    if not data:
        raise UploadRejected("File is empty")
    max_b = get_settings().max_upload_mb * 1024 * 1024
    if len(data) > max_b:
        raise UploadRejected(f"File exceeds {get_settings().max_upload_mb} MB limit")
    if is_dicom(data):
        return "dicom", MIME["dicom"]
    if ext not in ALLOWED_EXT:
        raise UploadRejected(f"Unsupported file type '{ext or 'none'}'. Allowed: PDF, JPG, PNG, DOCX, TXT, DICOM")
    kind = ALLOWED_EXT[ext]
    if kind == "pdf" and not data[:1024].lstrip().startswith(b"%PDF"):
        raise UploadRejected("File has .pdf extension but is not a valid PDF")
    if kind == "image":
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            return "image", "image/png"
        if data[:3] == b"\xff\xd8\xff":
            return "image", "image/jpeg"
        raise UploadRejected("File is not a valid JPEG/PNG image")
    if kind == "docx":
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                if "word/document.xml" not in z.namelist():
                    raise UploadRejected("Not a valid DOCX document")
        except zipfile.BadZipFile:
            raise UploadRejected("Not a valid DOCX document")
    if kind == "txt" and b"\x00" in data[:4096] and not data.startswith((b"\xff\xfe", b"\xfe\xff")):
        raise UploadRejected("Text file contains binary data")
    if kind == "dicom":
        # DICOM without preamble: let pydicom try with force=True later
        pass
    return kind, MIME[kind]


def save(data: bytes) -> tuple[str, str]:
    key = f"{uuid.uuid4().hex}.bin"
    (get_settings().storage_path / "uploads").mkdir(exist_ok=True)
    (get_settings().storage_path / "uploads" / key).write_bytes(encrypt_bytes(data))
    return key, hashlib.sha256(data).hexdigest()


def load(key: str) -> bytes:
    return decrypt_bytes((get_settings().storage_path / "uploads" / key).read_bytes())


def save_report(data: bytes) -> str:
    key = f"report_{uuid.uuid4().hex}.pdf.bin"
    (get_settings().storage_path / "uploads").mkdir(exist_ok=True)
    (get_settings().storage_path / "uploads" / key).write_bytes(encrypt_bytes(data))
    return key
