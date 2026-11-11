"""Native file dialog on the doctor's own computer, opened by voice.

Browsers only allow a page to open a file picker right after a click, so a voice
command can't do it. When the backend runs on the same machine as the browser
(the normal single-doctor setup), the backend opens a native "Open file" dialog
itself. The doctor still chooses the file; the model never chooses paths.

The dialog runs in a separate Python process so Tk never touches the server's threads.
"""
import json
import subprocess
import threading
import sys
from pathlib import Path

from .storage import ALLOWED_EXT

_SCRIPT = r"""
import json, sys, tkinter as tk
from tkinter import filedialog
title, patterns, initial = sys.argv[1], json.loads(sys.argv[2]), (sys.argv[3] or None)
root = tk.Tk(); root.withdraw(); root.attributes('-topmost', True); root.update()
path = filedialog.askopenfilename(parent=root, title=title, filetypes=patterns, initialdir=initial)
root.destroy()
print(json.dumps({"path": path or None}))
"""

FILETYPES = {
    "report": [("Medical reports", "*.pdf *.jpg *.jpeg *.png *.docx *.txt")],
    "previous": [("Medical reports", "*.pdf *.jpg *.jpeg *.png *.docx *.txt")],
    "xray": [("X-ray (DICOM or image)", "*.dcm *.dicom *.jpg *.jpeg *.png")],
    "ct": [("CT DICOM", "*.dcm *.dicom")],
    "mri": [("MRI DICOM", "*.dcm *.dicom")],
    "ultrasound": [("Ultrasound", "*.dcm *.dicom *.jpg *.jpeg *.png")],
    "photo": [("Photos", "*.jpg *.jpeg *.png *.webp")],
}


PHOTO_EXT = {".jpg", ".jpeg", ".png", ".webp"}


class PickerUnavailable(RuntimeError):
    pass


_lock = threading.Lock()
_current: subprocess.Popen | None = None
_cancelled: set[int] = set()


def pick_file(category: str, timeout_s: int = 300, initialdir: str | None = None) -> Path | None:
    """Show the dialog and wait for the user. Returns None if they cancel or the dialog is closed by cancel_pick()."""
    global _current
    cancel_pick()  # never stack two dialogs
    patterns = FILETYPES.get(category, FILETYPES["report"])
    title = "MedLens — choose a " + ("medical report" if category in ("report", "previous")
                                    else "photo of the problem area" if category == "photo" else category.upper() + " file")
    try:
        proc = subprocess.Popen([sys.executable, "-c", _SCRIPT, title, json.dumps(patterns), initialdir or ""],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    except OSError as e:
        raise PickerUnavailable(f"Could not open a file dialog: {e}")
    with _lock:
        _current = proc
    try:
        stdout, stderr = proc.communicate(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.communicate()
        return None
    finally:
        with _lock:
            if _current is proc:
                _current = None
    if proc.pid in _cancelled:
        _cancelled.discard(proc.pid)
        return None
    if proc.returncode != 0:
        raise PickerUnavailable(f"File dialog failed: {stderr.strip()[-300:]}")
    lines = stdout.strip().splitlines()
    path = json.loads(lines[-1]).get("path") if lines else None
    if not path:
        return None
    p = Path(path)
    allowed = PHOTO_EXT if category == "photo" else ALLOWED_EXT
    if p.suffix.lower() not in allowed or not p.is_file():
        raise PickerUnavailable("Selected file type is not supported")
    return p


def cancel_pick() -> bool:
    """Close the open file dialog (e.g. the file was already opened by voice). Returns True if one was open."""
    with _lock:
        proc = _current
    if proc is None or proc.poll() is not None:
        return False
    _cancelled.add(proc.pid)
    proc.kill()  # ends the dialog process, which closes its window
    return True
