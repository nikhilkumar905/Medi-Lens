"""Native file dialog on the doctor's own computer, opened by voice.

Browsers only allow a page to open a file picker right after a click, so a voice
command can't do it. When the backend runs on the same machine as the browser
(the normal single-doctor setup), the backend opens a native "Open file" dialog
itself. The doctor still chooses the file; the model never chooses paths.

The dialog runs in a separate Python process so Tk never touches the server's threads.
"""
import json
import subprocess
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
    "photo": [("Photos", "*.jpg *.jpeg *.png")],
}


class PickerUnavailable(RuntimeError):
    pass


def pick_file(category: str, timeout_s: int = 300, initialdir: str | None = None) -> Path | None:
    patterns = FILETYPES.get(category, FILETYPES["report"])
    title = "MedLens AI — choose a " + ("medical report" if category in ("report", "previous") else category.upper() + " file")
    try:
        out = subprocess.run([sys.executable, "-c", _SCRIPT, title, json.dumps(patterns), initialdir or ""],
                             capture_output=True, text=True, timeout=timeout_s)
    except subprocess.TimeoutExpired:
        return None
    except OSError as e:
        raise PickerUnavailable(f"Could not open a file dialog: {e}")
    if out.returncode != 0:
        raise PickerUnavailable(f"File dialog failed: {out.stderr.strip()[-300:]}")
    path = json.loads(out.stdout.strip().splitlines()[-1]).get("path")
    if not path:
        return None
    p = Path(path)
    if p.suffix.lower() not in ALLOWED_EXT or not p.is_file():
        raise PickerUnavailable("Selected file type is not supported")
    return p
