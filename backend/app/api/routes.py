"""HTTP API for MedLens."""
import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import create_token, require_doctor, verify_credentials
from app.models.entities import Analysis, AuditEvent, Document, Patient, Report
from app.schemas.api import (AnalysisUpdate, AskIn, CommandIn, InterpretIn, LoginIn, PatientIn, RouteIn, SymptomsIn, DiseaseIn, TranslateIn)
from app.services.dicom import dicom_service
from app.services.documents import analysis as analysis_svc
from app.services.documents import extractor, file_finder, local_picker, storage
from app.services.documents.lab_parser import evaluate
from app.services.llm import groq_client as llm
from app.services.medical_knowledge import pubmed, symptoms as symptoms_svc
from app.services.ocr.engine import ocr_available
from app.services.rag.retriever import bm25_search, index_document
from app.services.reports.pdf_report import build_pdf
from app.services.router import model_router
from app.services.voice import assistant
from app.services import translate as translate_svc
from app.services.vision import image_diagnosis

public = APIRouter(prefix="/api")
api = APIRouter(prefix="/api", dependencies=[Depends(require_doctor)])


def _llm_errors(fn):
    try:
        return fn()
    except llm.LLMNotConfigured as e:
        raise HTTPException(503, str(e))
    except llm.LLMError as e:
        raise HTTPException(502, str(e))


# ---------------- auth / system ----------------
@public.post("/auth/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    if not verify_credentials(body.username, body.password):
        audit(db, body.username, "login_failed")
        raise HTTPException(401, "Invalid username or password")
    audit(db, body.username, "login")
    return {"token": create_token(body.username), "doctor": body.username}


@public.get("/health")
def health():
    s = get_settings()
    return {"status": "ok", "llm_configured": s.llm_configured, "llm_model": s.groq_text_model,
            "stt_model": s.groq_stt_model, "ocr_available": ocr_available(),
            "pubmed": True, "phi_redaction": s.redact_phi_for_llm, "local_file_dialog": s.local_file_dialog}


@api.get("/models")
def models():
    return {"imaging": model_router.registry(), "llm": get_settings().groq_text_model}


@api.get("/audit")
def audit_log(db: Session = Depends(get_db), limit: int = 50):
    ev = db.query(AuditEvent).order_by(AuditEvent.id.desc()).limit(min(limit, 500)).all()
    return [{"id": e.id, "actor": e.actor, "action": e.action, "target": e.target, "details": e.details,
             "at": e.created_at.isoformat()} for e in ev]


# ---------------- patients ----------------
def _patient_out(p: Patient) -> dict:
    return {"id": p.id, "name": p.name, "age": p.age, "gender": p.gender, "mrn": p.mrn,
            "consent_ai_processing": p.consent_ai_processing, "notes": p.notes,
            "created_at": p.created_at.isoformat(), "document_count": len(p.documents)}


@api.get("/patients")
def list_patients(db: Session = Depends(get_db)):
    return [_patient_out(p) for p in db.query(Patient).order_by(Patient.name).all()]


@api.post("/patients")
def create_patient(body: PatientIn, db: Session = Depends(get_db), doctor: str = Depends(require_doctor)):
    p = Patient(**body.model_dump())
    db.add(p)
    db.commit()
    audit(db, doctor, "patient_created", f"patient:{p.id}")
    return _patient_out(p)


@api.patch("/patients/{pid}")
def update_patient(pid: int, body: PatientIn, db: Session = Depends(get_db), doctor: str = Depends(require_doctor)):
    p = db.get(Patient, pid) or _404()
    for k, v in body.model_dump().items():
        setattr(p, k, v)
    db.commit()
    audit(db, doctor, "patient_updated", f"patient:{pid}", consent=p.consent_ai_processing)
    return _patient_out(p)


@api.get("/patients/{pid}/documents")
def patient_documents(pid: int, db: Session = Depends(get_db)):
    docs = db.query(Document).filter_by(patient_id=pid).order_by(Document.created_at.desc()).all()
    return [_doc_summary(d) for d in docs]


def _404(what="Not found"):
    raise HTTPException(404, what)


# ---------------- documents ----------------
def _doc_summary(d: Document) -> dict:
    latest = d.analyses[-1] if d.analyses else None
    return {"id": d.id, "filename": d.filename, "content_type": d.content_type, "category": d.category,
            "size_bytes": d.size_bytes, "status": d.status, "patient_id": d.patient_id,
            "created_at": d.created_at.isoformat(), "latest_analysis_id": latest.id if latest else None,
            "review_status": latest.review_status if latest else None}


def _doc_out(d: Document) -> dict:
    return {**_doc_summary(d), "extraction": d.extraction}


@api.post("/documents/upload")
async def upload(file: UploadFile = File(...), category: str = Form("report"), patient_id: int | None = Form(None),
                 force_ocr: bool = Form(False), db: Session = Depends(get_db), doctor: str = Depends(require_doctor)):
    data = await file.read()
    name = (file.filename or "upload").replace("\\", "/").split("/")[-1][:200]
    return _ingest(db, doctor, name, data, category, patient_id, force_ocr)


class PickIn(BaseModel):
    category: str = "report"
    patient_id: int | None = None
    location: str | None = None


class FindIn(BaseModel):
    location: str | None = Field(default=None, max_length=300)
    query: str | None = Field(default=None, max_length=300)


class OpenIn(BaseModel):
    token: str
    category: str = "report"
    patient_id: int | None = None


def _local_only(request: Request):
    if request.client is None or request.client.host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(403, "Computer file access is only available when the browser runs on the server computer.")


@api.post("/files/find")
def find_files(body: FindIn, request: Request, db: Session = Depends(get_db), doctor: str = Depends(require_doctor)):
    """Search the doctor's folders for report files by spoken location + name. Returns names + opaque tokens."""
    _local_only(request)
    res = file_finder.find_files(body.location, body.query)
    audit(db, doctor, "files_searched", None, location=body.location, query=body.query, found=len(res["candidates"]))
    return res


@api.post("/files/open")
def open_found_file(body: OpenIn, request: Request, db: Session = Depends(get_db), doctor: str = Depends(require_doctor)):
    _local_only(request)
    path = file_finder.path_for_token(body.token)
    if path is None:
        raise HTTPException(404, "That file selection has expired. Please search again.")
    audit(db, doctor, "local_file_opened", None, filename=path.name)
    return _ingest(db, doctor, path.name[:200], path.read_bytes(), body.category, body.patient_id, False)


@api.post("/documents/pick-local")
def pick_local(body: PickIn, request: Request, db: Session = Depends(get_db), doctor: str = Depends(require_doctor)):
    """Open a native file dialog on this computer (voice-triggered upload). Localhost only."""
    if not get_settings().local_file_dialog:
        raise HTTPException(501, "Local file dialog is disabled (LOCAL_FILE_DIALOG=false).")
    _local_only(request)
    initial = None
    if body.location:
        dirs, _ = file_finder.resolve_location(body.location)
        dirs = [d for d in dirs if file_finder._is_allowed(d)]
        initial = str(dirs[0]) if dirs else None
    try:
        path = local_picker.pick_file(body.category, initialdir=initial)
    except local_picker.PickerUnavailable as e:
        raise HTTPException(501, str(e))
    if path is None:
        return {"cancelled": True}
    audit(db, doctor, "local_file_picked", None, filename=path.name)
    return _ingest(db, doctor, path.name[:200], path.read_bytes(), body.category, body.patient_id, False)


@api.post("/documents/pick-local/cancel")
def pick_local_cancel(request: Request):
    """Close the native file dialog if one is open (the file was chosen another way, e.g. by voice)."""
    _local_only(request)
    return {"closed": local_picker.cancel_pick()}


def _ingest(db: Session, doctor: str, name: str, data: bytes, category: str, patient_id: int | None, force_ocr: bool):
    try:
        kind, mime = storage.detect_kind(name, data)
    except storage.UploadRejected as e:
        raise HTTPException(400, str(e))
    if patient_id is not None and not db.get(Patient, patient_id):
        raise HTTPException(404, "Patient not found")
    if category not in assistant.UPLOAD_KINDS:
        category = "report"
    key, sha = storage.save(data)
    d = Document(patient_id=patient_id, filename=name, content_type=mime, category=category,
                 size_bytes=len(data), storage_key=key, sha256=sha, status="processing")
    db.add(d)
    db.commit()
    try:
        if kind == "pdf":
            d.extraction = extractor.extract_pdf(data, force_ocr=force_ocr)
        elif kind == "docx":
            d.extraction = extractor.extract_docx(data)
        elif kind == "txt":
            d.extraction = extractor.extract_txt(data)
        elif kind == "image":
            # photos/scans: OCR only for documents; medical images are routed to imaging
            d.extraction = extractor.extract_image(data) if category in ("report", "previous") else {"kind": "image", "pages": []}
        elif kind == "dicom":
            d.extraction = {"kind": "dicom", "pages": [], "dicom": dicom_service.read_metadata(data)}
        d.status = "extracted"
    except Exception as e:
        d.status = "failed"
        d.extraction = {"kind": kind, "pages": [], "error": f"Extraction failed: {e}"}
    db.commit()
    if d.extraction.get("pages"):
        index_document(db, d.id, patient_id, name, d.extraction["pages"])
    audit(db, doctor, "document_uploaded", f"document:{d.id}", kind=kind, category=category, sha256=sha)
    return _doc_out(d)


@api.get("/documents/{did}")
def get_document(did: int, db: Session = Depends(get_db)):
    return _doc_out(db.get(Document, did) or _404())


@api.delete("/documents/{did}")
def delete_document(did: int, db: Session = Depends(get_db), doctor: str = Depends(require_doctor)):
    d = db.get(Document, did) or _404()
    db.delete(d)
    db.commit()
    audit(db, doctor, "document_deleted", f"document:{did}")
    return {"ok": True}


@api.get("/documents/{did}/page/{page}")
def document_page(did: int, page: int, db: Session = Depends(get_db)):
    d = db.get(Document, did) or _404()
    data = storage.load(d.storage_key)
    if d.content_type == "application/pdf":
        try:
            return Response(extractor.render_pdf_page_png(data, page), media_type="image/png")
        except ValueError as e:
            raise HTTPException(400, str(e))
    if d.content_type.startswith("image/"):
        return Response(data, media_type=d.content_type)
    raise HTTPException(400, "No visual preview for this document type")


@api.get("/documents/{did}/dicom")
def dicom_frame(did: int, frame: int = 0, center: float | None = Query(None), width: float | None = Query(None),
                db: Session = Depends(get_db)):
    d = db.get(Document, did) or _404()
    if d.content_type != "application/dicom":
        raise HTTPException(400, "Not a DICOM document")
    try:
        return Response(dicom_service.render_frame(storage.load(d.storage_key), frame, center, width), media_type="image/png")
    except Exception as e:
        raise HTTPException(422, f"Cannot render DICOM pixel data: {e}")


# ---------------- analysis ----------------
def _analysis_out(a: Analysis) -> dict:
    return {"id": a.id, "document_id": a.document_id, "report_type": a.report_type, "structured": a.structured,
            "interpretation": a.interpretation, "model_name": a.model_name, "review_status": a.review_status,
            "doctor_notes": a.doctor_notes, "created_at": a.created_at.isoformat(),
            "updated_at": a.updated_at.isoformat() if a.updated_at else None,
            "reports": [{"id": r.id, "version": r.version, "created_at": r.created_at.isoformat()} for r in a.reports]}


def _consent_ok(d: Document) -> bool:
    return d.patient is None or d.patient.consent_ai_processing


@api.post("/documents/{did}/analyze")
def analyze(did: int, db: Session = Depends(get_db), doctor: str = Depends(require_doctor)):
    d = db.get(Document, did) or _404()
    if d.status == "failed" or not (d.extraction or {}).get("pages"):
        raise HTTPException(422, (d.extraction or {}).get("error") or "This document has no extractable text to analyze.")
    s = analysis_svc.structure_document(d, allow_llm=_consent_ok(d))
    a = Analysis(document_id=d.id, report_type=s["report_type"], structured=s, model_name=s.get("model"))
    db.add(a)
    d.status = "analyzed"
    db.commit()
    audit(db, doctor, "document_analyzed", f"analysis:{a.id}", method=s["structuring_method"])
    return _analysis_out(a)


@api.get("/analyses/{aid}")
def get_analysis(aid: int, db: Session = Depends(get_db)):
    return _analysis_out(db.get(Analysis, aid) or _404())


@api.post("/analyses/{aid}/interpret")
def interpret(aid: int, body: InterpretIn, db: Session = Depends(get_db), doctor: str = Depends(require_doctor)):
    a = db.get(Analysis, aid) or _404()
    if not _consent_ok(a.document):
        raise HTTPException(403, "Patient consent for automated analysis is not recorded. Update the patient record first.")
    a.interpretation = _llm_errors(lambda: analysis_svc.interpret(db, a, body.question))
    db.commit()
    audit(db, doctor, "analysis_interpreted", f"analysis:{aid}", model=a.interpretation.get("model"))
    return _analysis_out(a)


@api.get("/analyses/{aid}/compare")
def compare(aid: int, db: Session = Depends(get_db)):
    return analysis_svc.compare_with_previous(db, db.get(Analysis, aid) or _404())


@api.patch("/analyses/{aid}")
def update_analysis(aid: int, body: AnalysisUpdate, db: Session = Depends(get_db), doctor: str = Depends(require_doctor)):
    a = db.get(Analysis, aid) or _404()
    s = dict(a.structured)
    if body.rows is not None:
        rows = []
        for r in body.rows:
            rows.append({**r.model_dump(), "evaluation": evaluate(r.result, r.reference_interval, r.flag),
                         "verification": "doctor-edited", "bbox": None, "source_line": None,
                         "page": r.page or 1, "line_index": r.line_index or 0})
        s["rows"] = rows
        a.structured = s
        if a.review_status == "approved":
            a.review_status = "pending"  # edits after approval require re-approval
    if body.doctor_notes is not None:
        a.doctor_notes = body.doctor_notes
    if body.review_status is not None:
        a.review_status = body.review_status
    db.commit()
    audit(db, doctor, "analysis_updated", f"analysis:{aid}", status=a.review_status, edited_rows=body.rows is not None)
    return _analysis_out(a)


@api.post("/analyses/{aid}/reanalyze")
def reanalyze(aid: int, db: Session = Depends(get_db), doctor: str = Depends(require_doctor)):
    a = db.get(Analysis, aid) or _404()
    return analyze(a.document_id, db, doctor)


@api.post("/analyses/{aid}/report")
def generate_report(aid: int, db: Session = Depends(get_db), doctor: str = Depends(require_doctor)):
    a = db.get(Analysis, aid) or _404()
    if a.review_status != "approved":
        raise HTTPException(409, "The analysis must be reviewed and approved by the doctor before generating a PDF report.")
    version = db.query(Report).filter_by(analysis_id=aid).count() + 1
    pdf = build_pdf(a, a.document, a.document.patient, doctor, version)
    r = Report(analysis_id=aid, version=version, storage_key=storage.save_report(pdf))
    db.add(r)
    db.commit()
    audit(db, doctor, "report_generated", f"report:{r.id}", version=version)
    return {"id": r.id, "version": version, "created_at": r.created_at.isoformat()}


@api.get("/reports/{rid}/download")
def download_report(rid: int, db: Session = Depends(get_db), doctor: str = Depends(require_doctor)):
    r = db.get(Report, rid) or _404()
    audit(db, doctor, "report_downloaded", f"report:{rid}")
    return Response(storage.load(r.storage_key), media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="medlens_report_{r.analysis_id}_v{r.version}.pdf"'})


# ---------------- imaging ----------------
@api.post("/imaging/route")
def route_image(body: RouteIn, db: Session = Depends(get_db)):
    modality = body.modality
    meta = None
    if body.document_id:
        d = db.get(Document, body.document_id) or _404()
        meta = (d.extraction or {}).get("dicom")
        if meta and meta.get("Modality"):
            dicom_mod = {"CT": "ct", "MR": "mri", "CR": "xray", "DX": "xray", "US": "ultrasound"}.get(meta["Modality"])
            if dicom_mod and dicom_mod != modality:
                return {"supported": False, "reason": f"Modality mismatch: file is DICOM {meta['Modality']} but '{modality}' was requested.",
                        "message": f"This file is a {meta['Modality']} study, not {modality.upper()}. Please confirm the correct scan type."}
    return {**model_router.route(modality, body.body_part), "dicom": meta}


# ---------------- voice ----------------
@api.post("/voice/transcribe")
async def transcribe(audio: UploadFile = File(...), language: str | None = Form(None)):
    data = await audio.read()
    if len(data) < 1000:
        raise HTTPException(400, "Audio too short")
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(400, "Audio too long")
    lang = language if language in ("en", "hi", "te") else None
    res = _llm_errors(lambda: llm.transcribe(data, audio.filename or "speech.webm", lang))
    # Whisper is less confident on Hindi/Telugu, so accept a lower average log-probability there
    floor = -1.0 if lang in (None, "en") else -1.4
    res["uncertain"] = bool((res["no_speech_prob"] or 0) > 0.6 or (res["avg_logprob"] is not None and res["avg_logprob"] < floor)
                            or len(res["text"]) < 2)
    return res


class SpeakIn(BaseModel):
    text: str = Field(min_length=1, max_length=600)


@api.post("/voice/speak")
def speak(body: SpeakIn):
    audio = _llm_errors(lambda: llm.speak(body.text))
    return Response(audio, media_type="audio/wav")


@api.post("/voice/command")
def command(body: CommandIn, doctor: str = Depends(require_doctor), db: Session = Depends(get_db)):
    res = _llm_errors(lambda: assistant.interpret_command(body.text, body.history, body.context, body.language))
    if res["actions"]:
        audit(db, doctor, "voice_command", None, text=body.text[:200], actions=[a["name"] for a in res["actions"]])
    return res


# ---------------- knowledge / RAG ----------------
@api.get("/knowledge/pubmed")
def pubmed_search(q: str = Query(min_length=2, max_length=300), n: int = 5, db: Session = Depends(get_db)):
    try:
        arts = pubmed.search_pubmed(q, max_results=min(n, 10))
    except Exception as e:
        raise HTTPException(502, f"PubMed request failed: {e}")
    pubmed.ingest_articles(db, arts)
    return arts


ASK_PROMPT = """Answer the doctor's question using ONLY the numbered evidence passages when they are relevant,
citing them like [E1]. If the evidence does not cover the question, say so and give only brief, well-established
general knowledge clearly labelled as such. Never invent references, ranges or doses. Never prescribe or diagnose
definitively. Use short paragraphs suitable for being read aloud."""


@api.post("/knowledge/ask")
def ask(body: AskIn, db: Session = Depends(get_db), doctor: str = Depends(require_doctor)):
    warn = []
    if body.use_pubmed:
        try:
            pubmed.ingest_articles(db, pubmed.search_pubmed(body.question, max_results=4))
        except Exception as e:
            warn.append(f"PubMed retrieval failed: {e}")
    hits = bm25_search(db, body.question, k=6, patient_id=body.patient_id)
    ev = [{"id": f"E{i}", **h} for i, h in enumerate(hits, 1)]
    ctx = "\n\n".join(f"[{e['id']}] {e.get('title') or ''}\n{e['text']}" for e in ev) or "(no evidence found)"
    patient = db.get(Patient, body.patient_id) if body.patient_id else None
    if patient and not patient.consent_ai_processing:
        ev = [e for e in ev if e["source_type"] == "pubmed"]
        ctx = "\n\n".join(f"[{e['id']}] {e.get('title') or ''}\n{e['text']}" for e in ev) or "(no evidence found)"
        warn.append("Patient documents excluded: no consent for automated analysis on record.")
    msg, model = _llm_errors(lambda: llm.chat([
        {"role": "system", "content": ASK_PROMPT},
        {"role": "user", "content": llm.redact(f"Question: {body.question}\n\nEvidence:\n{ctx}", [patient.name if patient else None])[:24000]},
    ], max_tokens=900))
    audit(db, doctor, "knowledge_query", None, question=body.question[:200])
    return {"answer": msg.content, "model": model, "warnings": warn,
            "evidence": [{k: e.get(k) for k in ("id", "source_type", "source_id", "title", "page", "meta", "text")} for e in ev]}


@api.post("/symptoms/analyze")
def analyze_symptoms(body: SymptomsIn, db: Session = Depends(get_db), doctor: str = Depends(require_doctor)):
    patient = db.get(Patient, body.patient_id) if body.patient_id else None
    if patient and not patient.consent_ai_processing:
        raise HTTPException(403, "Patient consent for automated analysis is not recorded. Update the patient record first.")
    labs = None
    if body.analysis_id:
        a = db.get(Analysis, body.analysis_id)
        labs = a.structured.get("rows") if a else None
    res = _llm_errors(lambda: symptoms_svc.analyze_symptoms(db, body.text, body.patient_id, labs,
                                                             patient.name if patient else None))
    audit(db, doctor, "symptoms_analyzed", f"patient:{body.patient_id}" if body.patient_id else None, text=body.text[:200])
    return res


@api.post("/knowledge/disease")
def disease_info(body: DiseaseIn, db: Session = Depends(get_db), doctor: str = Depends(require_doctor)):
    res = _llm_errors(lambda: symptoms_svc.disease_info(db, body.disease))
    audit(db, doctor, "disease_info", None, disease=body.disease[:200])
    return res


# ---------------- photo-based triage ----------------
@api.post("/vision/analyze")
async def analyze_photo(image: UploadFile = File(...), body_part: str | None = Form(None),
                        notes: str | None = Form(None), db: Session = Depends(get_db),
                        doctor: str = Depends(require_doctor)):
    data = await image.read(image_diagnosis.MAX_IMAGE_BYTES + 1)
    if len(data) > image_diagnosis.MAX_IMAGE_BYTES:
        raise HTTPException(413, "Image is too large. Please use a photo under 3.5 MB.")
    mime = image_diagnosis.detect_image_type(data)
    if not mime:
        raise HTTPException(415, "Please upload a JPG, PNG or WEBP photo.")
    bp = (body_part or "").strip()[:60] or None
    res = _llm_errors(lambda: image_diagnosis.analyze_image(data, mime, bp, (notes or "").strip()[:800] or None))
    audit(db, doctor, "photo_analyzed", None, body_part=bp,
          top=(res.get("possible_conditions") or [{}])[0].get("condition"))
    return res


# ---------------- translation (Hindi / Telugu) ----------------
@api.post("/translate")
def translate(body: TranslateIn):
    if len(json.dumps(body.data, ensure_ascii=False)) > 60000:
        raise HTTPException(413, "Too much text to translate at once.")
    return {"language": body.language, "data": _llm_errors(lambda: translate_svc.translate_object(body.data, body.language))}
