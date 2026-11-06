"""Medical document structuring, RAG-grounded interpretation and report comparison."""
import re
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.entities import Analysis, Document
from app.services.llm import groq_client as llm
from app.services.medical_knowledge import pubmed
from app.services.rag.retriever import bm25_search

from .lab_parser import classify_report, evaluate, parse_lab_rows, parse_patient_fields

MANUAL = "Requires manual verification"

STRUCTURE_PROMPT = """You extract laboratory data from medical report text. The text is given as numbered lines
("L<page>.<line>: ..."). Return JSON:
{"report_type": str|null, "age": str|null, "gender": str|null, "report_date": str|null,
 "laboratory_name": str|null,
 "rows": [{"line": "L<page>.<line>", "test_name": str, "result": str, "unit": str|null,
           "reference_interval": str|null, "flag": str|null}],
 "observations": [str]}
Rules: copy values EXACTLY as written (keep decimals, units, '<', '>', ranges). Never infer or invent a value,
unit, or reference interval that is not on that line. Each row must come from one line; never mix rows.
Use null for missing fields. "observations" = free-text remarks/impressions printed in the report only."""

INTERPRET_PROMPT = """You are a clinical decision-support assistant for a doctor. You receive structured lab
findings extracted from a report and numbered evidence passages [E1], [E2] ... retrieved from PubMed and the
patient's own prior documents. Return JSON:
{"summary": str,
 "abnormal_findings": [{"test": str, "explanation": str, "evidence": ["E1"]}],
 "interpretation": str,
 "differential_considerations": [{"condition": str, "likelihood": "more likely"|"possible"|"less likely",
                                  "rationale": str, "evidence": ["E2"]}],
 "suggested_further_evaluation": [str],
 "limitations": [str],
 "spoken_summary": str}
"spoken_summary": 2-4 sentences in a warm, natural, conversational tone as if talking to a colleague (no lists,
no markdown, no citations): what the report shows, the main abnormal values, and the most likely possibilities.
Rules: base differentials on sound clinical reasoning, not only on the topics of the evidence passages. An abnormal lab value is NOT a diagnosis — phrase differentials as possibilities to consider. Cite only
the evidence IDs provided (cite them whenever a passage is relevant); if no passage supports a statement, cite nothing and say it is general knowledge.
Never invent reference ranges, drug doses, guidelines or references. Never prescribe. Do not state confidence
percentages. Keep it concise and clinically useful."""


def _norm(s: str) -> str:
    return re.sub(r"\s+", "", (s or "")).lower()


def _numbered_lines(pages: list[dict]) -> tuple[str, dict]:
    idx, out = {}, []
    for p in pages:
        for i, ln in enumerate(p["lines"]):
            key = f"L{p['page']}.{i}"
            idx[key] = (p, i, ln)
            out.append(f"{key}: {ln['text']}")
    return "\n".join(out), idx


def structure_document(doc: Document, allow_llm: bool = True) -> dict:
    pages = (doc.extraction or {}).get("pages", [])
    full_text = "\n".join(p["text"] for p in pages)
    det_rows = parse_lab_rows(pages)
    patient = parse_patient_fields(full_text)
    types = classify_report(full_text)
    result = {
        "patient": patient,
        "report_type": types[0]["type"] if types else "Other / unclassified report",
        "report_type_candidates": types,
        "rows": det_rows,
        "observations": [],
        "structuring_method": "deterministic-parser",
        "warnings": [],
        "model": None,
    }
    if not full_text.strip():
        result["warnings"].append("No readable text was extracted from this document.")
        return result
    if not get_settings().llm_configured:
        result["warnings"].append("GROQ_API_KEY not configured — used deterministic parser only.")
        return result
    if not allow_llm:
        result["warnings"].append("Patient has not consented to AI processing — external LLM not used.")
        return result

    numbered, idx = _numbered_lines(pages)
    numbered = llm.redact(numbered, [patient.get("patient_name")])
    try:
        data, model = llm.chat_json([
            {"role": "system", "content": STRUCTURE_PROMPT},
            {"role": "user", "content": numbered[:24000]},
        ], max_tokens=6000, temperature=0.0)
    except (llm.LLMError, llm.LLMNotConfigured) as e:
        result["warnings"].append(f"LLM structuring unavailable: {e}. Deterministic parser used.")
        return result

    rows, seen_lines = [], set()
    for r in data.get("rows") or []:
        key = str(r.get("line", ""))
        if key not in idx or not r.get("result") or not r.get("test_name"):
            continue
        page, li, ln = idx[key]
        line_n = _norm(ln["text"])
        res = str(r["result"]).strip()
        ref = (str(r["reference_interval"]).strip() if r.get("reference_interval") else None)
        unit = (str(r["unit"]).strip() if r.get("unit") else None)
        # anti-hallucination: every value must literally appear on its source line
        verified = _norm(res) in line_n and (ref is None or _norm(ref) in line_n) and (unit is None or _norm(unit) in line_n)
        if ref and _norm(ref) not in line_n:
            ref = None
        if unit and _norm(unit) not in line_n:
            unit = None
        rows.append({
            "test_name": r["test_name"], "result": res, "unit": unit, "reference_interval": ref,
            "flag": r.get("flag") if r.get("flag") and _norm(str(r["flag"])) in line_n else None,
            "evaluation": evaluate(res, ref), "page": page["page"], "line_index": li, "bbox": ln.get("bbox"),
            "verification": "source-matched" if verified and not ln.get("low_confidence") else MANUAL,
            "source_line": ln["text"],
        })
        seen_lines.add((page["page"], li))
    # keep deterministic rows the LLM skipped
    for d in det_rows:
        if (d["page"], d["line_index"]) not in seen_lines:
            rows.append(d)
    rows.sort(key=lambda x: (x["page"], x["line_index"]))

    result.update({
        "rows": rows,
        "observations": [o for o in (data.get("observations") or []) if isinstance(o, str)],
        "structuring_method": "groq-llm + source validation",
        "model": model,
    })
    if data.get("report_type"):
        result["report_type"] = data["report_type"]
    for f in ("age", "gender", "report_date", "laboratory_name"):
        v = data.get(f)
        if v and _norm(str(v)) in _norm(full_text) and not patient.get(f):
            patient[f] = str(v)
    return result


def _evidence_query(structured: dict, question: str | None) -> str:
    abn = [r["test_name"] for r in structured.get("rows", []) if r["evaluation"]["status"] in ("high", "low")]
    parts = [question or "", structured.get("report_type") or ""] + abn[:6]
    return " ".join(p for p in parts if p).strip()


def gather_evidence(db: Session, structured: dict, patient_id: int | None, question: str | None = None,
                    fetch_pubmed: bool = True) -> list[dict]:
    query = _evidence_query(structured, question)
    warnings = []
    if fetch_pubmed and query:
        abn = [r for r in structured.get("rows", []) if r["evaluation"]["status"] in ("high", "low")]
        terms = [f'("{r["test_name"]}"[tiab]) AND ({"elevated" if r["evaluation"]["status"] == "high" else "low"})'
                 for r in abn[:3]] or ([question] if question else [structured.get("report_type", "")])
        for t in terms:
            try:
                pubmed.ingest_articles(db, pubmed.search_pubmed(f"{t} AND review[pt]", max_results=3))
            except Exception as e:  # network errors should not break analysis
                warnings.append(f"PubMed retrieval failed: {e}")
                break
    hits = bm25_search(db, query, k=8, patient_id=patient_id)
    for h in hits:
        h["warnings"] = warnings
    return hits


def interpret(db: Session, analysis: Analysis, question: str | None = None) -> dict:
    structured = analysis.structured
    patient_id = analysis.document.patient_id
    evidence = gather_evidence(db, structured, patient_id, question)
    # exclude the document being interpreted from its own evidence
    evidence = [e for e in evidence if not (e["source_type"] == "document" and e["source_id"] == str(analysis.document_id))]
    ev_list = []
    for i, e in enumerate(evidence, 1):
        ev_list.append({"id": f"E{i}", **e})
    findings = [{k: r[k] for k in ("test_name", "result", "unit", "reference_interval", "flag")} | {"status": r["evaluation"]["status"]}
                for r in structured.get("rows", [])]
    ev_text = "\n\n".join(f"[{e['id']}] ({e['source_type']}{' PMID ' + e['source_id'] if e['source_type'] == 'pubmed' else ''}) "
                          f"{e.get('title') or ''}\n{e['text']}" for e in ev_list) or "(no evidence retrieved)"
    pt = structured.get("patient", {})
    user = (f"Report type: {structured.get('report_type')}\nAge: {pt.get('age')}  Gender: {pt.get('gender')}\n"
            f"Findings: {findings}\nReport observations: {structured.get('observations')}\n"
            f"Doctor's question: {question or 'Explain the abnormal findings.'}\n\nEvidence:\n{ev_text}")
    data, model = llm.chat_json([{"role": "system", "content": INTERPRET_PROMPT},
                                 {"role": "user", "content": llm.redact(user, [pt.get("patient_name")])[:28000]}],
                                max_tokens=3500, temperature=0.2, reasoning_effort="medium")
    valid_ids = {e["id"] for e in ev_list}

    def clean_ids(ids):
        return [i for i in (ids or []) if i in valid_ids]

    for f in data.get("abnormal_findings") or []:
        f["evidence"] = clean_ids(f.get("evidence"))
    for d in data.get("differential_considerations") or []:
        d["evidence"] = clean_ids(d.get("evidence"))
    data["limitations"] = list(data.get("limitations") or []) + [
        "AI-generated interpretation — requires review and approval by the treating doctor.",
        "Clinical validation data not available for this LLM-based interpretation.",
    ]
    data["evidence"] = [{k: e.get(k) for k in ("id", "source_type", "source_id", "title", "page", "meta", "text")} for e in ev_list]
    data["model"] = model
    data["generated_at"] = datetime.now(timezone.utc).isoformat()
    data["question"] = question
    return data


def compare_with_previous(db: Session, analysis: Analysis) -> dict:
    patient_id = analysis.document.patient_id
    if patient_id is None:
        return {"available": False, "message": "This document is not linked to a patient, so previous reports cannot be retrieved."}
    prev = (db.query(Analysis).join(Document).filter(Document.patient_id == patient_id, Analysis.id != analysis.id)
            .order_by(Analysis.created_at).all())
    if not prev:
        return {"available": False, "message": "No previous reports found for this patient."}

    def key(name: str) -> str:
        return re.sub(r"[^a-z0-9]", "", name.lower())

    series: dict[str, dict] = {}
    for a in prev + [analysis]:
        date = a.structured.get("patient", {}).get("report_date") or a.created_at.date().isoformat()
        for r in a.structured.get("rows", []):
            s = series.setdefault(key(r["test_name"]), {"test_name": r["test_name"], "points": []})
            s["points"].append({"analysis_id": a.id, "document": a.document.filename, "date": date, "result": r["result"],
                                "unit": r.get("unit"), "status": r["evaluation"]["status"], "current": a.id == analysis.id})
    comparisons = []
    for s in series.values():
        if len(s["points"]) < 2 or not any(p["current"] for p in s["points"]):
            continue
        nums = []
        for p in s["points"]:
            m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*$", p["result"] or "")
            nums.append(float(m.group(1)) if m else None)
        units = {p["unit"] for p in s["points"] if p["unit"]}
        trend = None
        if len(units) <= 1 and nums[-1] is not None and nums[-2] is not None:
            d = nums[-1] - nums[-2]
            trend = "increased" if d > 0 else "decreased" if d < 0 else "unchanged"
            s["change"] = round(d, 4)
        elif len(units) > 1:
            s["note"] = "Units differ between reports — not directly comparable."
        s["trend"] = trend
        comparisons.append(s)
    return {"available": True, "previous_count": len(prev), "comparisons": comparisons}
