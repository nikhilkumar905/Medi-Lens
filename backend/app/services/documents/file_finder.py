"""Voice-driven file finding on the doctor's own computer.

"Open the CBC report from Downloads" -> resolve the folder -> fuzzy-match report files
-> return candidates. Safety rules:
  * only folders under the allowed roots (user's home folders + FILE_SEARCH_ROOTS),
  * only report/image file types (PDF, JPG, PNG, DOCX, TXT, DICOM),
  * system, program and dependency folders are skipped,
  * the client receives opaque tokens, never raw paths it can send back.
"""
import difflib
import os
import re
import secrets
import time
from pathlib import Path

from app.core.config import get_settings

from .storage import ALLOWED_EXT

HOME = Path.home()
SKIP_DIRS = {"windows", "program files", "program files (x86)", "programdata", "appdata", "$recycle.bin",
             "system volume information", "node_modules", ".venv", "venv", ".git", "__pycache__", "site-packages",
             "storage", ".cache", "library"}
MAX_FILES = 8000
MAX_DEPTH = 4

_tokens: dict[str, tuple[Path, float]] = {}
TOKEN_TTL = 30 * 60


def _known_folders() -> dict[str, list[Path]]:
    od = [p for p in HOME.glob("OneDrive*") if p.is_dir()]
    def both(name):
        return [p for p in [HOME / name, *[o / name for o in od]] if p.is_dir()]
    return {
        "downloads": both("Downloads"), "desktop": both("Desktop"), "documents": both("Documents"),
        "pictures": both("Pictures"), "onedrive": od, "home": [HOME],
    }


SYNONYMS = {"download": "downloads", "downloads": "downloads", "desktop": "desktop", "documents": "documents",
            "document": "documents", "docs": "documents", "my documents": "documents", "pictures": "pictures",
            "photos": "pictures", "onedrive": "onedrive", "one drive": "onedrive", "home": "home"}


def allowed_roots() -> list[Path]:
    roots = [HOME]
    for r in (get_settings().file_search_roots or "").split(";"):
        if r.strip():
            p = Path(r.strip()).expanduser()
            if p.is_dir():
                roots.append(p)
    return [r.resolve() for r in roots]


def _is_allowed(p: Path) -> bool:
    try:
        rp = p.resolve()
    except OSError:
        return False
    # allowed if some root contains it without passing through system/dependency folders below that root
    return any((rp == r or r in rp.parents) and not any(part.lower() in SKIP_DIRS for part in rp.relative_to(r).parts)
               for r in allowed_roots())


def resolve_location(location: str | None) -> tuple[list[Path], str]:
    """Turn spoken location text into folders. Returns (folders, human label)."""
    known = _known_folders()
    loc = (location or "").strip().strip("\"'")
    if not loc:
        dirs = known["downloads"] + known["desktop"] + known["documents"]
        return dirs, "Downloads, Desktop and Documents"
    low = loc.lower().replace("folder", "").strip()
    for key, canon in SYNONYMS.items():
        if low == key or low.startswith(key + " ") or low.startswith(key + "/") or low.startswith(key + "\\"):
            rest = low[len(key):].strip(" /\\")
            bases = known[canon]
            if rest:
                bases = [b / rest for b in bases if (b / rest).is_dir()] or bases
            return bases, loc
    # drive / path: "D:\\medi", "d drive medi", "D:/reports"
    m = re.match(r"^([a-zA-Z])\s*(?::|\s+drive)\s*[\\/]?\s*(.*)$", loc, re.I)
    if m:
        p = Path(f"{m.group(1).upper()}:\\") / m.group(2).strip().replace(" / ", "/")
    else:
        p = Path(loc).expanduser()
        if not p.is_absolute():
            # a folder name somewhere in the usual places
            hits = [b / loc for v in known.values() for b in v if (b / loc).is_dir()]
            if hits:
                return hits[:3], loc
            p = HOME / loc
    return ([p] if p.is_dir() else []), loc


def _norm(s: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", s.lower()) if t]


def _score(query_tokens: list[str], name: str) -> float:
    stem = Path(name).stem.lower()
    toks = _norm(stem)
    if not query_tokens:
        return 0.0
    hits = 0.0
    for q in query_tokens:
        if q in toks:
            hits += 1
        elif any(t.startswith(q) or q in t for t in toks):
            hits += 0.7
        elif any(difflib.SequenceMatcher(None, q, t).ratio() > 0.8 for t in toks):
            hits += 0.6
    return hits / len(query_tokens) * 0.8 + difflib.SequenceMatcher(None, " ".join(query_tokens), " ".join(toks)).ratio() * 0.2


STOP_WORDS = {"the", "a", "an", "my", "file", "report", "pdf", "document", "of", "for", "named", "called", "please",
              "open", "from", "in", "latest", "recent", "newest", "last"}


def find_files(location: str | None, query: str | None, limit: int = 6) -> dict:
    folders, label = resolve_location(location)
    folders = [f for f in folders if _is_allowed(f)]
    if not folders:
        return {"folder": label, "candidates": [], "error": f"I can't find or access the folder '{label}'."}
    q = query or ""
    qt = [t for t in _norm(q) if t not in STOP_WORDS]
    want_latest = bool(re.search(r"\b(latest|newest|recent|last)\b", q, re.I))
    files: list[tuple[Path, os.stat_result]] = []
    for base in folders:
        base_depth = len(base.parts)
        for root, dirs, names in os.walk(base):
            dirs[:] = [d for d in dirs if d.lower() not in SKIP_DIRS and not d.startswith(".")]
            if len(Path(root).parts) - base_depth >= MAX_DEPTH:
                dirs[:] = []
            for n in names:
                if n.startswith(("~$", ".")):  # Office lock files / hidden files
                    continue
                if Path(n).suffix.lower() in ALLOWED_EXT:
                    p = Path(root) / n
                    try:
                        files.append((p, p.stat()))
                    except OSError:
                        pass
                if len(files) >= MAX_FILES:
                    break
            if len(files) >= MAX_FILES:
                break
    if qt:
        scored = [(_score(qt, p.name), st.st_mtime, p, st) for p, st in files]
        scored = [s for s in scored if s[0] >= 0.45]
        scored.sort(key=lambda x: (-x[0], -x[1]))
    else:  # "latest report in Downloads"
        med = re.compile(r"(medical|report|lab|blood|cbc|test|scan|xray|x-ray|mri|ct|ultrasound|usg|patholog|"
                         r"diagnos|lipid|thyroid|liver|kidney|urine|glucose|hba1c|prescription|discharge|"
                         r"consult|radiolog|ecg|echo|biopsy|clinic|hospital|patient)", re.I)
        # medical-looking names first, then newest
        scored = sorted(((1.0, st.st_mtime, p, st) for p, st in files),
                        key=lambda x: (0 if med.search(x[2].stem) else 1, -x[1]))
        scored = [s for s in scored if s[2].suffix.lower() in (".pdf", ".docx", ".txt", ".jpg", ".jpeg", ".png")]
    now = time.time()
    for k in [k for k, (_, t) in _tokens.items() if now - t > TOKEN_TTL]:
        _tokens.pop(k, None)
    out = []
    for score, mtime, p, st in scored[:limit]:
        tok = secrets.token_urlsafe(12)
        _tokens[tok] = (p, now)
        out.append({"token": tok, "name": p.name, "folder": str(p.parent), "size_bytes": st.st_size,
                    "modified": mtime, "score": round(score, 3)})
    # Auto-open only a clear name match, or the newest file when the doctor explicitly asked for "latest".
    # A vague "a report from Downloads" shows a list to choose from instead of opening a random file.
    if qt:
        confident = bool(out) and out[0]["score"] >= 0.75 and (len(out) == 1 or out[0]["score"] - out[1]["score"] >= 0.15)
    else:
        confident = bool(out) and (want_latest or len(out) == 1)
    return {"folder": label, "searched": [str(f) for f in folders], "candidates": out, "confident": confident}


def path_for_token(token: str) -> Path | None:
    item = _tokens.get(token)
    if not item or time.time() - item[1] > TOKEN_TTL:
        return None
    p = item[0]
    return p if p.is_file() and _is_allowed(p) else None
