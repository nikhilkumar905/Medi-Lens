"""Heuristics that decide whether natively extracted PDF text is trustworthy.

Corrupted extraction typically comes from custom font encodings or fonts without a
ToUnicode map. The symptoms are private-use-area code points, U+FFFD replacement
characters, control characters, or long runs of symbol glyphs instead of words.
"""
import re
import unicodedata
from dataclasses import dataclass, field

_WORD_RE = re.compile(r"[A-Za-zÀ-ɏऀ-ॿ]{2,}")
_VOWEL_RE = re.compile(r"[aeiouyAEIOUY]")


@dataclass
class QualityReport:
    char_count: int
    reliable: bool
    score: float
    issues: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"char_count": self.char_count, "reliable": self.reliable,
                "score": round(self.score, 3), "issues": self.issues}


def inspect_text(text: str, min_chars: int = 40) -> QualityReport:
    stripped = "".join(ch for ch in text if not ch.isspace())
    n = len(stripped)
    issues: list[str] = []
    if n < min_chars:
        return QualityReport(n, False, 0.0, ["Little or no native text (likely scanned page or image)"])

    pua = sum(1 for ch in stripped if 0xE000 <= ord(ch) <= 0xF8FF or 0xF0000 <= ord(ch))
    repl = stripped.count("�")
    ctrl = sum(1 for ch in stripped if unicodedata.category(ch) in ("Cc", "Cf", "Co", "Cn"))
    symbols = sum(1 for ch in stripped if unicodedata.category(ch).startswith("S"))
    readable = sum(1 for ch in stripped if ch.isalnum() or ch in ".,:;()-/%<>=+*[]'\"#&_")

    bad_ratio = (pua + repl + ctrl) / n
    symbol_ratio = symbols / n
    readable_ratio = readable / n

    words = _WORD_RE.findall(text)
    word_like = [w for w in words if _VOWEL_RE.search(w) or w.isupper()]
    word_ratio = (len(word_like) / len(words)) if words else 0.0

    if pua:
        issues.append(f"{pua} private-use glyphs (custom font encoding / missing Unicode map)")
    if repl:
        issues.append(f"{repl} replacement characters (unmapped glyphs)")
    if ctrl - pua > 0:
        issues.append(f"{ctrl - pua} control/unassigned characters")
    if symbol_ratio > 0.15:
        issues.append(f"High symbol density ({symbol_ratio:.0%}) suggests incorrect character mapping")
    if words and word_ratio < 0.6:
        issues.append("Extracted tokens do not resemble words")
    if not words:
        issues.append("No word-like tokens found")

    score = max(0.0, min(1.0, readable_ratio - 2 * bad_ratio - max(0, symbol_ratio - 0.05))) * (
        0.5 + 0.5 * word_ratio
    )
    reliable = bad_ratio < 0.02 and symbol_ratio <= 0.15 and readable_ratio > 0.8 and word_ratio >= 0.6
    return QualityReport(n, reliable, score, issues)
