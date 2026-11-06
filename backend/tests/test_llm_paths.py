"""LLM code paths with Groq mocked: verifies anti-hallucination validation and citation cleaning."""
from types import SimpleNamespace

from app.core.config import get_settings
from app.services.documents import analysis as A
from app.services.documents.extractor import extract_pdf
from app.services.voice import assistant


def _doc(pdf):
    return SimpleNamespace(extraction=extract_pdf(pdf), id=1)


def test_llm_values_not_on_source_line_are_flagged(monkeypatch, lab_pdf):
    monkeypatch.setattr(get_settings(), "groq_api_key", "test")
    doc = _doc(lab_pdf)
    lines = doc.extraction["pages"][0]["lines"]
    hb = next(i for i, l in enumerate(lines) if l["text"].startswith("Haemoglobin"))
    plt = next(i for i, l in enumerate(lines) if l["text"].startswith("Platelet"))

    def fake_chat_json(messages, **kw):
        assert "Test Person" not in messages[1]["content"]  # PHI redacted before leaving the server
        return {"report_type": "Complete Blood Count (CBC)", "rows": [
            {"line": f"L1.{hb}", "test_name": "Haemoglobin", "result": "11.2", "unit": "g/dL", "reference_interval": "13.0 - 17.0"},
            {"line": f"L1.{plt}", "test_name": "Platelet Count", "result": "9.9", "unit": "lakhs/cumm", "reference_interval": "1.5 - 4.5"},
            {"line": "L9.99", "test_name": "Invented", "result": "1"},
        ], "observations": ["Mild microcytic picture."]}, "mock-model"

    monkeypatch.setattr(A.llm, "chat_json", fake_chat_json)
    s = A.structure_document(doc)
    rows = {r["test_name"]: r for r in s["rows"]}
    assert rows["Haemoglobin"]["verification"] == "source-matched"
    assert rows["Platelet Count"]["verification"] == "Requires manual verification"  # 9.9 not in source
    assert "Invented" not in rows
    assert s["model"] == "mock-model"


def test_consent_blocks_llm(monkeypatch, lab_pdf):
    monkeypatch.setattr(get_settings(), "groq_api_key", "test")
    monkeypatch.setattr(A.llm, "chat_json", lambda *a, **k: (_ for _ in ()).throw(AssertionError("LLM must not be called")))
    s = A.structure_document(_doc(lab_pdf), allow_llm=False)
    assert any("consent" in w for w in s["warnings"])


def test_voice_command_tool_call_validated(monkeypatch):
    calls = [SimpleNamespace(function=SimpleNamespace(name="select_body_part", arguments='{"body_part": "lungs"}')),
             SimpleNamespace(function=SimpleNamespace(name="delete_everything", arguments="{}"))]
    monkeypatch.setattr(assistant.llm, "chat", lambda *a, **k: (SimpleNamespace(content="", tool_calls=calls), "mock"))
    r = assistant.interpret_command("investigate the lungs", [], {})
    assert [a["name"] for a in r["actions"]] == ["select_body_part"]
    assert r["errors"] and "Unknown action" in r["errors"][0]
