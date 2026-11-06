from app.services.documents.extractor import extract_pdf, extract_txt
from app.services.documents.lab_parser import classify_report, evaluate, parse_lab_rows, parse_range
from app.services.documents.text_quality import inspect_text


def test_reliable_text_detected():
    q = inspect_text("Report Status Male Age Test Report Haemoglobin 13.5 g/dL Reference 13.0 - 17.0")
    assert q.reliable


def test_corrupted_private_use_text_detected():
    corrupted = "   " * 10
    q = inspect_text(corrupted)
    assert not q.reliable
    assert any("private-use" in i for i in q.issues)


def test_symbol_garbage_detected():
    q = inspect_text("☐☒☓ ⌘⌥⌫ ⍟⎈⏏ ♠♣♥ ✦✧✩ ☐☒☓ ⌘⌥⌫ ⍟⎈⏏ ♠♣♥ ✦✧✩ ☐☒☓ ⌘⌥⌫ ⍟⎈⏏ ♠♣♥")
    assert not q.reliable


def test_scanned_page_flagged():
    assert not inspect_text("   ").reliable


def test_pdf_native_extraction_preserves_rows(lab_pdf):
    ex = extract_pdf(lab_pdf)
    page = ex["pages"][0]
    assert page["method"] == "native"
    assert page["quality"]["reliable"]
    rows = parse_lab_rows(ex["pages"])
    by_name = {r["test_name"]: r for r in rows}
    hb = by_name["Haemoglobin"]
    assert hb["result"] == "11.2" and hb["unit"] == "g/dL" and hb["reference_interval"] == "13.0 - 17.0"
    assert hb["evaluation"]["status"] == "low"
    assert by_name["Platelet Count"]["evaluation"]["status"] == "high"
    assert by_name["Total WBC Count"]["evaluation"]["status"] == "normal"
    assert by_name["MCV"]["result"] == "82.5"  # decimal precision preserved
    assert hb["bbox"] and all(0 <= v <= 1 for v in hb["bbox"])


def test_classify_cbc(lab_pdf):
    text = "\n".join(p["text"] for p in extract_pdf(lab_pdf)["pages"])
    assert classify_report(text)[0]["type"].startswith("Complete Blood Count")


def test_ranges_and_comparisons():
    assert parse_range("< 200")["high"] == 200
    assert parse_range("13.0-17.0") == {"low": 13.0, "high": 17.0, "unit": None}
    assert evaluate("<0.5", "0.4 - 4.0")["status"] == "indeterminate"
    assert evaluate("250", "< 200")["status"] == "high"
    assert evaluate("5.0", None)["status"] == "no_reference"


def test_txt_extraction_columns():
    ex = extract_txt(b"TSH    6.8    uIU/mL    0.4 - 4.0\nFree T4    1.1    ng/dL    0.8 - 1.8\n")
    rows = parse_lab_rows(ex["pages"])
    assert rows[0]["test_name"] == "TSH" and rows[0]["evaluation"]["status"] == "high"
    assert rows[1]["evaluation"]["status"] == "normal"
