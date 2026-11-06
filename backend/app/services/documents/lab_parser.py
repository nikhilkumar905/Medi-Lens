"""Deterministic laboratory-row parsing and reference-interval evaluation.

Values are always kept as the exact source strings (units, decimals, comparison
symbols). Numeric comparisons only use the reference interval printed on the
report — ranges are never invented.
"""
import re

NUM = r"\d+(?:[.,]\d+)?"
RESULT_RE = re.compile(rf"^(?P<cmp>[<>≤≥]=?)?\s*(?P<num>{NUM})\s*(?P<flag>\*|H|L|HH|LL|High|Low|HIGH|LOW|Abnormal)?$")
RANGE_RE = re.compile(
    rf"^(?:(?P<lo>{NUM})\s*(?:-|–|—|to)\s*(?P<hi>{NUM})"
    rf"|(?P<cmp>[<>≤≥]=?|Up\s*to|upto|Less\s*than|More\s*than|Greater\s*than)\s*(?P<val>{NUM}))"
    rf"\s*(?P<unit>[^\d\s].*)?$",
    re.IGNORECASE,
)
FLAG_RE = re.compile(r"^(\*|H|L|HH|LL|High|Low|HIGH|LOW|Abnormal|Critical)$")
UNIT_RE = re.compile(
    r"^(?:%|[a-zA-Zµμ]{1,6}(?:/[a-zA-Zµμ0-9.^]{1,8})?|10\^?\d+/[a-zA-Zµμ]+|x?10[³⁶9]/[a-zA-Zµμ]+|"
    r"[a-zA-Zµμ]+/\d*[a-zA-Zµμ]+|mill?ion/[a-z]+|cells/[a-zµμ]+|lakhs?/[a-z]+|thou/[a-z]+|"
    r"(?:m|µ|μ|n|p)?(?:g|mol|IU|U)/(?:d|m|µ|μ)?L|fL|pg|g/dL|mg/dL|mmol/L|IU/L|U/L)$"
)
NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9 ,()/.%+\-&'’:]*[A-Za-z0-9)]$")

REPORT_TYPES = {
    "Complete Blood Count (CBC)": ["haemoglobin", "hemoglobin", "rbc", "wbc", "platelet", "hematocrit", "mcv", "mch", "neutrophil", "lymphocyte"],
    "Lipid Profile": ["cholesterol", "triglyceride", "hdl", "ldl", "vldl"],
    "Liver Function Test": ["bilirubin", "sgot", "sgpt", "alt", "ast", "alkaline phosphatase", "albumin", "ggt"],
    "Kidney Function Test": ["creatinine", "urea", "bun", "uric acid", "egfr"],
    "Thyroid Function Test": ["tsh", "t3", "t4", "thyroxine", "triiodothyronine"],
    "Blood Glucose": ["glucose", "hba1c", "fasting blood sugar", "postprandial", "fbs", "ppbs"],
    "Urine Analysis": ["urine", "pus cells", "epithelial", "specific gravity", "ketone", "urobilinogen"],
    "Histopathology": ["histopathology", "biopsy", "microscopic", "gross examination", "specimen"],
    "Radiology Report": ["impression", "radiograph", "x-ray", "ct scan", "mri", "ultrasound", "usg", "findings:"],
}


def classify_report(text: str) -> list[dict]:
    low = text.lower()
    scored = []
    for name, kws in REPORT_TYPES.items():
        hits = sorted({k for k in kws if re.search(rf"\b{re.escape(k)}\b", low)})
        if hits:
            scored.append({"type": name, "matched_terms": hits, "score": len(hits)})
    scored.sort(key=lambda x: -x["score"])
    return scored


def _to_float(s: str) -> float:
    return float(s.replace(",", "."))


def parse_range(s: str) -> dict | None:
    m = RANGE_RE.match(s.strip())
    if not m:
        return None
    if m.group("lo") is not None:
        lo, hi = _to_float(m.group("lo")), _to_float(m.group("hi"))
        return {"low": lo, "high": hi, "unit": (m.group("unit") or "").strip() or None} if lo <= hi else None
    cmp = m.group("cmp").lower().replace(" ", "")
    val = _to_float(m.group("val"))
    unit = (m.group("unit") or "").strip() or None
    if cmp in ("<", "<=", "≤", "upto", "lessthan"):
        return {"low": None, "high": val, "unit": unit, "inclusive": cmp != "<"}
    return {"low": val, "high": None, "unit": unit, "inclusive": cmp not in (">",)}


LEAD_RE = re.compile(rf"^(?P<cmp>[<>≤≥]=?)?\s*(?P<num>{NUM})\s*(?P<rest>[%A-Za-zµμ/(].*)$")
_HIGH_FLAGS = {"h", "hh", "high", "critical high", "abnormal high", "↑"}
_LOW_FLAGS = {"l", "ll", "low", "critical low", "abnormal low", "↓"}


def _unit_key(u: str | None) -> str:
    return re.sub(r"\s+", "", (u or "").lower()).replace("μ", "µ")


def evaluate(result: str, reference: str | None, flag: str | None = None) -> dict:
    """Compare a result against the report's own reference interval; if that is impossible, fall back to the
    High/Low flag printed on the report. Never invents a range."""
    ev = _compare(result, reference)
    if ev["status"] in ("high", "low", "normal"):
        return ev
    f = (flag or "").strip().lower()
    if f in _HIGH_FLAGS:
        return {"status": "high", "note": "Marked high on the report"}
    if f in _LOW_FLAGS:
        return {"status": "low", "note": "Marked low on the report"}
    if f == "normal":
        return {"status": "normal", "note": "Marked normal on the report"}
    if f in ("abnormal", "*", "critical"):
        return {"status": "abnormal", "note": "Marked abnormal on the report"}
    return ev


def _compare(result: str, reference: str | None) -> dict:
    if not reference:
        return {"status": "no_reference", "note": "No reference interval supplied in report"}
    rng = parse_range(reference)
    rm = RESULT_RE.match((result or "").strip())
    if not rng:
        return {"status": "unparsed_reference", "note": "Reference interval could not be interpreted"}
    if not rm:
        # e.g. "8.6% (70 mmol/mol)" or "84 µmol/L": use the leading value when its unit matches the range's unit
        lm = LEAD_RE.match((result or "").strip())
        if not lm:
            return {"status": "non_numeric", "note": "Result is not a single numeric value"}
        res_unit = re.match(r"[^\s(]+", lm.group("rest").strip())
        res_unit = res_unit.group(0) if res_unit else ""
        if rng.get("unit") and _unit_key(res_unit) != _unit_key(rng["unit"].split()[0]):
            return {"status": "indeterminate", "note": f"Result unit ({res_unit}) differs from reference unit ({rng['unit']})"}
        rm = lm
    if rm.group("cmp"):
        return {"status": "indeterminate", "note": "Result reported with a comparison symbol"}
    v = _to_float(rm.group("num"))
    if rng["low"] is not None and v < rng["low"]:
        return {"status": "low", "note": f"Below reference ({reference})"}
    if rng["high"] is not None and (v > rng["high"] or (v == rng["high"] and rng.get("inclusive") is False)):
        return {"status": "high", "note": f"Above reference ({reference})"}
    return {"status": "normal", "note": "Within reference interval"}


def _split_line_regex(text: str) -> list[str]:
    """Fallback splitter when a line has no column cells."""
    m = re.match(
        rf"^(?P<name>[A-Za-z][A-Za-z0-9 ,()/.%+\-&']*?)\s+(?P<result>[<>≤≥]?=?\s*{NUM})\s*"
        rf"(?P<flag>H|L|High|Low|\*)?\s*(?P<rest>.*)$", text.strip())
    if not m:
        return [text]
    parts = [m.group("name"), m.group("result")]
    if m.group("flag"):
        parts.append(m.group("flag"))
    rest = m.group("rest").strip()
    rm = re.search(rf"([<>≤≥]=?\s*{NUM}|{NUM}\s*(?:-|–|to)\s*{NUM}).*$", rest)
    if rm:
        unit = rest[: rm.start()].strip()
        if unit:
            parts.append(unit)
        parts.append(rm.group(0).strip())
    elif rest:
        parts.append(rest)
    return parts


def parse_lab_rows(pages: list[dict]) -> list[dict]:
    rows = []
    for page in pages:
        for li, line in enumerate(page["lines"]):
            cells = [c["text"].strip() for c in line["cells"] if c["text"].strip()]
            if len(cells) < 2:
                cells = _split_line_regex(line["text"])
            if len(cells) < 2 or not NAME_RE.match(cells[0]) or len(cells[0]) > 60:
                continue
            result = flag = unit = ref = None
            for c in cells[1:]:
                if result is None and RESULT_RE.match(c):
                    rm = RESULT_RE.match(c)
                    result = c if not rm.group("flag") else c[: rm.start("flag")].strip()
                    flag = rm.group("flag")
                elif result is not None and flag is None and FLAG_RE.match(c):
                    flag = c
                elif result is not None and ref is None and parse_range(c):
                    ref = c
                elif result is not None and unit is None and UNIT_RE.match(c):
                    unit = c
            if result is None:
                continue
            ev = evaluate(result, ref, flag)
            low_conf = line.get("low_confidence", False)
            rows.append({
                "test_name": cells[0],
                "result": result,
                "unit": unit,
                "reference_interval": ref,
                "flag": flag,
                "evaluation": ev,
                "page": page["page"],
                "line_index": li,
                "bbox": line.get("bbox"),
                "verification": "Requires manual verification" if low_conf else "source-matched",
                "source_line": line["text"],
            })
    return rows


def parse_patient_fields(text: str) -> dict:
    def grab(pattern: str) -> str | None:
        m = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
        return m.group(1).strip(" :-\t") if m else None

    stop = r"(?=\s{2,}|\t|$|\s+(?:Age|Sex|Gender|Date|Ref|Lab|Sample|UHID|MRN|Reg)\b)"
    age_sex = re.search(r"(\d{1,3})\s*(?:Y|Yrs?|Years?)\s*/\s*(Male|Female|M|F)\b", text, re.IGNORECASE)
    return {
        "patient_name": grab(rf"(?:Patient\s*Name|Name\s*of\s*Patient|^Name)\s*[:\-]?\s*((?:Mr|Mrs|Ms|Miss|Dr|Master|Baby)?\.?\s*[A-Za-z][A-Za-z .']{{1,60}}?){stop}"),
        "age": (age_sex.group(1) if age_sex else None) or grab(r"\bAge\s*[:\-]?\s*(\d{1,3}\s*(?:Y|Yrs?|Years?|M|Months?)?)\b"),
        "gender": (age_sex.group(2) if age_sex else None) or grab(r"\b(?:Sex|Gender)\s*[:\-]?\s*(Male|Female|M|F|Other)\b"),
        "report_date": grab(r"(?:Report(?:ed)?\s*(?:Date|On)|Date\s*of\s*Report|Collected\s*On|Date)\s*[:\-]?\s*(\d{1,2}[/\-. ][A-Za-z0-9]{1,9}[/\-. ]\d{2,4}(?:\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)?)"),
        "laboratory_name": grab(r"^([A-Z][A-Za-z&.' ]{3,60}(?:Laborator(?:y|ies)|Diagnostics?|Pathology|Labs?|Hospital|Clinic))\b"),
    }
