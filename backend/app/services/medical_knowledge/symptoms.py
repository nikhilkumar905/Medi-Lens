"""Symptom analysis: extract symptoms from free speech, retrieve PubMed evidence (RAG),
then reason about possible conditions. Doctor-facing decision support only."""
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.services.llm import groq_client as llm
from app.services.medical_knowledge import pubmed
from app.services.rag.retriever import bm25_search

EXTRACT_PROMPT = """Extract the clinical picture from what the doctor said (they may be describing a patient or
themselves, casually, possibly with speech-recognition errors). Return JSON:
{"symptoms": [{"name": str, "details": str|null}], "age": str|null, "sex": str|null,
 "duration": str|null, "context": str|null,
 "pubmed_query": str}
"pubmed_query": a concise PubMed query (<=8 words) for differential diagnosis of the main symptom combination.
Only include what was actually said. Use null when not mentioned."""

ANALYZE_PROMPT = """You are a clinical decision-support assistant talking to a doctor. Given the extracted
symptoms, optional lab findings, and numbered evidence passages [E1].. from PubMed and the patient's records,
return JSON:
{"possible_conditions": [{"condition": str, "likelihood": "more likely"|"possible"|"less likely",
   "reasoning": str, "evidence": ["E1"]}],
 "red_flags": [str],
 "recommended_evaluation": [str],
 "follow_up_questions": [str],
 "spoken_summary": str}
Rules: build the differential from sound clinical reasoning across common, important and can't-miss causes
(including infectious, inflammatory/autoimmune, and regionally common conditions) — do NOT limit it to the topics of
the evidence passages; use passages only to support items they genuinely relate to. Give 4-7 possible conditions
ordered by likelihood; these are possibilities, never a diagnosis. Use
qualitative likelihood words only — no percentages. Cite only evidence IDs given; if none fit, cite nothing.
"red_flags": warning signs that would need urgent care, if relevant. "follow_up_questions": 2-4 questions that
would best narrow the differential. Never prescribe drugs or doses.
"spoken_summary": 2-4 sentences in a warm, natural, conversational tone as if speaking to a colleague
(contractions ok, no lists, no markdown, no citations), mentioning the top possibilities and one key follow-up
question."""


def analyze_symptoms(db: Session, text: str, patient_id: int | None = None,
                     lab_findings: list[dict] | None = None, patient_name: str | None = None) -> dict:
    s = get_settings()
    said = llm.redact(text, [patient_name])
    extracted, _ = llm.chat_json([{"role": "system", "content": EXTRACT_PROMPT},
                                  {"role": "user", "content": said[:4000]}],
                                 model=s.groq_fast_model, max_tokens=1500, temperature=0.0)
    warnings = []
    query = (extracted.get("pubmed_query") or "").strip()
    if query:
        try:
            pubmed.ingest_articles(db, pubmed.search_pubmed(f"({query}) AND (diagnosis OR differential)", max_results=4))
        except Exception as e:
            warnings.append(f"PubMed retrieval failed: {e}")
    sym_names = " ".join(x.get("name", "") for x in extracted.get("symptoms") or [])
    hits = bm25_search(db, f"{query} {sym_names}", k=6, patient_id=patient_id)
    ev = [{"id": f"E{i}", **h} for i, h in enumerate(hits, 1)]
    ev_text = "\n\n".join(f"[{e['id']}] {e.get('title') or ''}\n{e['text']}" for e in ev) or "(no evidence retrieved)"
    labs = ""
    if lab_findings:
        labs = "Lab findings from the current report: " + "; ".join(
            f"{r['test_name']} {r['result']} {r.get('unit') or ''} ({r['evaluation']['status']})" for r in lab_findings)
    data, model = llm.chat_json([
        {"role": "system", "content": ANALYZE_PROMPT},
        {"role": "user", "content": f"Doctor said: {said}\n\nExtracted: {extracted}\n{labs}\n\nEvidence:\n{ev_text}"[:24000]},
    ], max_tokens=3000, temperature=0.3, reasoning_effort="medium")
    valid = {e["id"] for e in ev}
    for c in data.get("possible_conditions") or []:
        c["evidence"] = [i for i in c.get("evidence") or [] if i in valid]
        if c.get("likelihood") not in ("more likely", "possible", "less likely"):
            c["likelihood"] = "possible"
    return {
        "input": text,
        "extracted": extracted,
        **data,
        "evidence": [{k: e.get(k) for k in ("id", "source_type", "source_id", "title", "page", "meta", "text")} for e in ev],
        "warnings": warnings,
        "limitations": ["AI-generated differential for decision support — not a diagnosis. Requires clinical assessment.",
                        "Clinical validation data not available."],
        "model": model,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
