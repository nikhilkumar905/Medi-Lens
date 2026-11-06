# MedLens AI

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg) ![Python](https://img.shields.io/badge/Python-3.11%E2%80%933.13-blue) ![React](https://img.shields.io/badge/React-19-61dafb) ![FastAPI](https://img.shields.io/badge/FastAPI-backend-009688)

A voice-first medical report assistant for one doctor, built from the *MedLens AI Master Prompt*. The spec asked for Gemini. This version uses **Groq** (LLM + Whisper speech-to-text) with **RAG**, a **FastAPI** backend and a **React** single-page UI.

> **Decision support only.** This is not a certified medical device. Every AI output must be reviewed and approved by the doctor. Use synthetic data unless your hospital has approved the environment.

## Features

| Area | What it does |
|---|---|
| **Guided home flow** | Animated anatomy figure (scan beam, beating heart). Tap the body or the mic and the assistant asks *"How can I help you?"*: **(1) Analyze a medical report**, either by uploading a file (browse, drag-and-drop, or by voice: "the CBC report in Downloads") or by showing it to the camera; **(2) Ask about a disease or get advice**, either by checking symptoms (tap chips or speak) to see possible conditions, or by learning about a named disease |
| **Friendly results** | Animated cards instead of long paragraphs: a severity meter, key points, out-of-range values with low/normal/high bars and a plain-language meaning, possible conditions, and colour-coded cards for **precautions**, **things to avoid**, **prevention**, **causes**, **healthy habits** and **when to see a doctor**. Tappable follow-up questions are answered by voice |
| **Single-page workspace** (Advanced) | Interactive SVG anatomy (front/back, zoom, 30 regions) · workflow area · voice assistant panel |
| **Voice** | Hands-free mic with voice-activity detection, transcription by Groq Whisper, spoken replies via browser TTS, barge-in (talking interrupts the assistant), time-of-day greeting, confirmation by saying "yes"/"no" |
| **Voice commands** | Groq function calling over 17 whitelisted UI actions (`select_body_part`, `open_report_upload`, `analyze_medical_document`, `generate_medical_report`, …). The server validates every tool call (unknown actions and invalid arguments are rejected), and sensitive actions need confirmation |
| **PDF extraction** | PyMuPDF native text → **text-quality inspection** (private-use glyphs, U+FFFD, symbol density, non-word tokens, Type3/custom font encodings, scanned-image coverage) → OCR **only on unreliable pages** (300 DPI render → OpenCV denoise/deskew/binarise → Tesseract). Page numbers, line cells and bounding boxes are preserved |
| **Lab structuring** | Deterministic row parser plus Groq JSON extraction. **Every LLM value must appear literally on its source line**; otherwise it is marked *Requires manual verification*. Rows the model invents are dropped |
| **Evaluation** | Results are compared **only** against the reference interval printed on the report. No ranges are invented |
| **RAG** | BM25 retrieval over (a) the patient's own earlier documents and (b) PubMed abstracts fetched live via NCBI E-utilities. The LLM must cite `[E#]` passage IDs, and IDs that don't exist are removed |
| **Comparison** | Trends for matching tests across a patient's reports, with a unit-mismatch guard |
| **Review & PDF** | Edit or correct values, add notes, approve or reject, re-analyze. The ReportLab PDF has 13 sections and is generated **only after approval**. Editing after approval resets the status to pending |
| **Imaging** | DICOM metadata, windowing presets and slice navigation. The model router checks the modality (it catches DICOM-tag mismatches) and **refuses** when no validated model is configured. It never fabricates findings |
| **Security** | JWT doctor login, uploads encrypted at rest (Fernet), magic-byte validation, patient consent gate for LLM use, patient-name redaction before text goes to Groq, audit log, API keys kept on the server only |

## Quick start (Windows / macOS / Linux)

**Prerequisites:** Python 3.11–3.13, Node 20+, and a [Groq API key](https://console.groq.com/keys). Optional: [Tesseract OCR](https://github.com/UB-Mannheim/tesseract/wiki) for scanned or corrupted PDFs.

```bash
# 0. Clone
git clone https://github.com/nikhilkumar905/Medi-Lens.git
cd Medi-Lens

# 1. Backend
cd backend
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env            # macOS/Linux: cp .env.example .env
#   -> edit .env: set GROQ_API_KEY, SECRET_KEY, DOCTOR_PASSWORD
uvicorn app.main:app --reload --port 8000

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev                        # http://localhost:5173
```

Sign in with `DOCTOR_USERNAME` / `DOCTOR_PASSWORD` from `.env` (default `doctor` / `medlens123`; change it). Allow microphone and camera access when the browser asks. Both need `localhost` or HTTPS.

### Docker (PostgreSQL)
```bash
cp backend/.env.example backend/.env   # set GROQ_API_KEY etc.
docker compose up --build              # http://localhost:8080
```

### Tests
```bash
cd backend && .venv\Scripts\python -m pytest -q
```
There are 23 tests. They cover text-quality detection, row and unit preservation, range evaluation, upload validation, auth, the approval gate, PDF output, comparison, tool-call validation, the model router, and the LLM paths with Groq mocked (hallucinated values flagged, PHI redaction, consent gate).

## Example voice commands
Guided flow: "I need help" · "One" / "Analyze my report" · "Two" / "Ask about a disease" · "Upload a file" · "Use the camera" → "Capture" · "Tell me about dengue" · "I have fever and joint pain for 3 days" · "Read the results" · "Go back" · "Main menu"

Advanced workspace: "Investigate the lungs" · "Open report upload" · "Upload a CT scan" · "Open the camera" / "Capture the image" · "Analyze the document" · "Explain the abnormal findings" · "Compare previous reports" · "Search PubMed for iron deficiency anemia" · "Read the findings" · "Generate a PDF" → "yes" · "Download the report" · "Stop speaking" · "Repeat that" · "Go back" · "Cancel"

> Browsers only open file dialogs after a real click. When you say "upload a report", the drop zone pulses, and one click opens the picker.

## Architecture

```
frontend/ (React + TS + Tailwind + Framer Motion, Vite proxy /api -> :8000)
  src/App.tsx                 orchestrator + voice action dispatcher
  src/hooks/useVoice.ts       mic, VAD, recording, TTS, barge-in
  src/components/             AnatomyViewer, VoiceAssistant, ExtractionViewer,
                              AnalysisPanel, BodyInvestigation, PatientBar, Overlays
backend/app/
  api/routes.py               REST API
  core/                       config, DB, JWT + encryption, audit
  models/entities.py          patients, documents, analyses, reports, knowledge_chunks, audit_events
  services/documents/         extractor (PDF/DOCX/TXT/image), text_quality, lab_parser, analysis, storage
  services/ocr/engine.py      OpenCV preprocessing + Tesseract
  services/rag/retriever.py   chunking + BM25
  services/medical_knowledge/pubmed.py   E-utilities search/fetch/ingest
  services/llm/groq_client.py chat, JSON mode, tool calls, Whisper, PHI redaction
  services/voice/assistant.py tool schema + validation
  services/router/model_router.py   modality-aware routing (MONAI/MedGemma candidates)
  services/dicom/             pydicom metadata + windowed rendering
  services/reports/           ReportLab PDF
```

## Imaging models and validation status
No imaging models are bundled or downloaded automatically. The development laptop (RTX 2050, 4 GB) is too small for them. `model_router.py` lists the candidate models (MONAI `spleen_ct_segmentation`, `wholeBody_ct_segmentation`, `brats_mri_segmentation`, `lung_nodule_ct_detection`; MedGemma 4B), each with its model-card link. Until `MONAI_MODEL_PATH` / `MEDGEMMA_MODEL_PATH` point to downloaded weights on a suitable GPU server, those tasks show **"unsupported — no AI findings generated"**. All model outputs show *"Clinical validation data not available."* No accuracy figures are claimed.

## Privacy notes
- Text sent to Groq has the patient's name removed (`REDACT_PHI_FOR_LLM=true`). Other identifiers in free text may remain, so get hospital approval for the data-processing arrangement before using real data.
- A patient without recorded AI consent gets deterministic parsing only. LLM interpretation is blocked (HTTP 403).
- Uploaded files and generated PDFs are encrypted at rest with a key derived from `SECRET_KEY`. Rotating that key makes existing files unreadable.

## Configuration & secrets
`backend/.env` holds your Groq key, `SECRET_KEY` and doctor password. It is **git-ignored**, so never commit it. Start from `backend/.env.example`. The `storage/` folder (SQLite DB, encrypted uploads, generated PDFs) and any sample patient reports are also ignored.

## Before any clinical deployment
This still needs: independent clinical validation, a hospital security review (HTTPS/TLS termination, backups, retention policy), a privacy and data-processing agreement with the LLM provider, and the applicable regulatory review.

## License
Released under the [MIT License](LICENSE). The license covers the code only. It is not a certification for clinical use.
