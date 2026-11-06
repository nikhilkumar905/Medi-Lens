<div align="center">

<img src="docs/screenshots/orb-listening.png" alt="MedLens voice button" width="110" />

# MedLens

### Your voice-first medical report and health assistant

Talk to it in **English, हिन्दी or తెలుగు**. Tap a part of the body, upload a lab report or a photo of a rash or wound, and get a clear, doctor-style explanation with precautions, things to avoid and when to see a doctor.

[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg)](LICENSE)
![Python](https://img.shields.io/badge/Python-3.11%E2%80%933.13-3776ab?logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-backend-009688?logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6?logo=typescript&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-4-38bdf8?logo=tailwindcss&logoColor=white)
![Groq](https://img.shields.io/badge/Groq-LLM%20%2B%20Whisper-f55036)
![Tests](https://img.shields.io/badge/tests-23%20passing-22c55e)

[Features](#-features) · [Screenshots](#-screenshots) · [Quick start](#-quick-start) · [Voice commands](#%EF%B8%8F-voice-commands) · [How it works](#-how-it-works) · [Configuration](#%EF%B8%8F-configuration) · [API](#-api-reference) · [Troubleshooting](#-troubleshooting)

</div>

> [!IMPORTANT]
> **Decision support only.** MedLens is not a certified medical device. Every result is a possibility to discuss with a doctor, never a diagnosis, and every report must be reviewed and approved by a registered medical practitioner. Use synthetic data unless your hospital has approved the environment.

---

## 📸 Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/language-picker.png" alt="Language picker" /><br /><b>1 · Choose your language</b>: English, हिन्दी or తెలుగు, every time the app opens.</td>
    <td width="50%"><img src="docs/screenshots/home.png" alt="Home screen with anatomy figure" /><br /><b>2 · Tap the body or just talk</b>: the interactive anatomy figure starts the conversation.</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/voice-stage-hindi.png" alt="Voice-only navigation in Hindi" /><br /><b>3 · Voice-only navigation</b>: after a tap, the assistant asks what you need and listens (shown in Hindi).</td>
    <td><img src="docs/screenshots/report-top.png" alt="Clinical report analysis" /><br /><b>4 · Official-style report analysis</b>: letterhead, status stamp, patient panel, flagged results.</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/photo-prediction.png" alt="Photo prediction of a skin condition" /><br /><b>5 · Photo of a disease or injury</b>: possible conditions, symptoms, causes, home care, precautions.</td>
    <td><img src="docs/screenshots/pdf-report-page1.png" alt="Generated PDF report" /><br /><b>6 · Printable PDF report</b>: generated only after the doctor approves the analysis.</td>
  </tr>
</table>

<details>
<summary><b>More screenshots</b>: full report, PDF page 2, voice button states</summary>
<br />

| Listening | Speaking | Muted |
|:---:|:---:|:---:|
| <img src="docs/screenshots/orb-listening.png" width="150" /> | <img src="docs/screenshots/orb-speaking.png" width="150" /> | <img src="docs/screenshots/orb-muted.png" width="150" /> |
| 🩺 Stethoscope, reacts to your voice | 💓 ECG heartbeat trace | 🩺 Stethoscope with a slash |

<img src="docs/screenshots/report-full.png" alt="Full report analysis" width="700" />

<img src="docs/screenshots/pdf-report-page2.png" alt="PDF report page 2" width="500" />

</details>

---

## ✨ Features

### 🗣️ Voice-first, in three languages
| | |
|---|---|
| **Language picker** | English / हिन्दी / తెలుగు is asked on every launch. Switch any time from the top bar, even on the login page. |
| **Whole interface translated** | Hand-checked translations for all main screens and spoken prompts. Any remaining English text (buttons, hints, placeholders, tooltips, error messages) is translated automatically once and cached in the browser. Medical values, units and test names stay exactly as printed. |
| **Speech recognition** | Groq Whisper, told which language you speak, so Hindi and Telugu are recognised well. Hindi works in Devanagari or romanised ("mujhe report check karni hai"). |
| **Spoken replies** | The assistant answers in your language and speaks with a matching browser voice (Hindi / Telugu / Indian-English when available). |
| **Hands-free loop** | Voice-activity detection, barge-in (talk to interrupt), "stop", "repeat", and a real pause: when paused it neither listens nor speaks. |
| **Quick commands** | Short phrases like "one / two / three", "एक / दो / तीन", "ఒకటి / రెండు / మూడు", "file", "back", "yes / हाँ / అవును" work instantly, without a server round-trip. |
| **Medical voice button** | 🩺 Stethoscope while listening (bounces with your voice), 💓 ECG trace while speaking, crossed stethoscope when muted, 🧠 brain while thinking. |

### 🧍 Interactive anatomy
- A colour-coded human figure with **27 tappable regions**: brain, eyes, ears, nose, mouth, jaw, neck, shoulders, chest, lungs, heart, liver, gallbladder, stomach, spleen, pancreas, kidneys, small and large intestine, pelvis, bladder, reproductive organs, arms, legs, knees and feet. Spine, ribs and skull can be chosen by voice.
- A beating heart, breathing lungs, a scanning beam and a glow on hover. Labels follow the selected language.
- Tapping a part switches the microphone on and starts **voice-only navigation**: the assistant asks what you need, with no menus to click.

### 📄 Medical report analysis
- **Upload any way you like:** drag and drop, browse, **say the file's name** ("the CBC report in Downloads"), or **show the paper to the camera**.
- **Just say "file"** (or "upload", "फ़ाइल", "ఫైల్") to open the file picker. If you then name the file by voice, MedLens opens it **and closes the file picker automatically**.
- **Smart extraction:** native PDF text first, then a **text-quality check** (broken glyphs, symbol noise, custom fonts, scanned pages), with **OCR only where needed** (OpenCV clean-up and Tesseract). Page numbers and positions are kept.
- **Reliable lab values:**
  - A rule-based parser plus a language-model pass. **Every value must literally appear on its source line**, otherwise it is marked *requires manual verification*, and invented rows are dropped.
  - Results with units inside them ("8.6% (70 mmol/mol)", "84 µmol/L") are read correctly.
  - The report's own **High/Low/Abnormal flags** are used when a range can't be compared.
  - **Unit mismatches** (mg/dL against mmol/L) are never guessed.
  - Narrative sentences ("recheck in 2 weeks", "Page 1") are filtered out.
- **Evaluation only against the printed reference range**: no invented ranges.
- **An official-style results screen:**
  - letterhead with report ID
  - *Pending review / Approved / Rejected* stamp
  - patient panel
  - totals (tests / outside range / within range)
  - clinical impression with a priority meter
  - full results table with an *abnormal only* filter
  - abnormal findings explained on low-normal-high scales
  - clinical considerations, recommendations, further tests and references
  - a "Verified by (doctor)" signature line
- **Evidence (RAG):** BM25 search over the patient's own documents plus PubMed abstracts fetched live. Citations `[E#]` that don't exist are removed.
- **Review and PDF:** approve and download a polished **A4 PDF**. It has a branded header and footer, "Page X of Y", a summary card, an at-a-glance strip, a colour-coded results table with legend, patient advice boxes, all **13 required sections** and a signature block. A PDF is created **only after approval**.

### 📷 Photo of a disease or injury
- Upload or take a photo of a **rash, skin spot, wound, burn, bite, swelling or injured area**, with optional notes ("itchy for 2 weeks").
- You get:
  - **what is visible**
  - **possible conditions** ranked by likelihood
  - **severity**
  - possible **symptoms**, **causes**, **home care / first aid**, **precautions**, **things to avoid**, **prevention**
  - **when to see a doctor**
  - **tests a doctor may do**
- Photos are resized in the browser, analysed and **never stored**. Non-medical or blurry photos are detected and explained.

### 🩺 Symptoms and disease information
- Tap symptom chips or just describe them ("fever and joint pain for 3 days"). You get possible conditions with likelihood, red flags, follow-up questions (tap to answer by voice), causes, precautions, prevention, and suggested tests.
- Ask about any disease ("tell me about dengue"): overview, symptoms, causes, risk factors, prevention, precautions, what to avoid, how it is diagnosed, and when to see a doctor.

### 🔐 Privacy and safety
- JWT doctor login, uploads **encrypted at rest** (Fernet), file-type checks by magic bytes, audit log.
- **Patient name redacted** before any text is sent to the language model. A consent gate blocks interpretation for patients without recorded consent.
- API keys stay on the server. `.env`, the database and uploads are git-ignored.
- Generated text never presents itself as "AI". If sincerely asked, the assistant says it is an *automated software assistant*, never a human.

---

## 🚀 Quick start

**You need:** Python 3.11–3.13, Node.js 20+, and a free [Groq API key](https://console.groq.com/keys). Optional: [Tesseract OCR](https://github.com/UB-Mannheim/tesseract/wiki) for scanned or photographed reports.

```bash
# 0. Get the code
git clone https://github.com/nikhilkumar905/Medi-Lens.git
cd Medi-Lens
```

<table>
<tr><th>🐍 Backend (terminal 1)</th><th>⚛️ Frontend (terminal 2)</th></tr>
<tr><td>

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate      # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env      # macOS/Linux: cp .env.example .env
# edit .env → GROQ_API_KEY, SECRET_KEY, DOCTOR_PASSWORD
uvicorn app.main:app --port 8000
```

</td><td>

```bash
cd frontend
npm install
npm run dev
# open http://localhost:5173
```

</td></tr>
</table>

1. Open **http://localhost:5173** and pick your language.
2. Sign in with `DOCTOR_USERNAME` / `DOCTOR_PASSWORD` from `backend/.env` (default `doctor` / `medlens123`; **change it**).
3. Allow **microphone** and **camera** access when the browser asks. Both need `localhost` or HTTPS.
4. Tap a body part, or tap the mic and say *"I need help"*.

> [!TIP]
> After changing `backend/.env` (for example a new Groq key), **restart the backend**: settings are read once at start-up.

### 🐳 Docker (PostgreSQL)
```bash
cp backend/.env.example backend/.env    # set GROQ_API_KEY etc.
docker compose up --build               # open http://localhost:8080
```

### ✅ Tests
```bash
cd backend
.venv\Scripts\python -m pytest -q       # 23 tests
```
The tests cover:
- text-quality detection
- row and unit preservation, and reference-range evaluation
- upload validation, authentication, and the approval gate before PDFs
- PDF output and report comparison
- voice tool-call validation and the imaging model router
- the language-model paths with Groq mocked: invented values flagged, patient-name redaction, consent gate

---

## 🎙️ Voice commands

Speak naturally: anything that isn't a quick command goes to the assistant, which understands free sentences in all three languages.

| What you want | English | हिन्दी | తెలుగు |
|---|---|---|---|
| Start | "I need help" | "मुझे मदद चाहिए" | "నాకు సహాయం కావాలి" |
| Analyze a report (option 1) | "one", "analyze my report" | "एक", "रिपोर्ट जाँचो" | "ఒకటి", "రిపోర్ట్ చూడు" |
| Disease / symptoms (option 2) | "two", "I have fever and headache" | "दो", "मुझे बुखार है" | "రెండు", "నాకు జ్వరం ఉంది" |
| Photo of disease / injury (option 3) | "three", "check a photo" | "तीन", "चोट की फ़ोटो" | "మూడు", "గాయం ఫోటో" |
| Open the file picker | "file", "upload" | "फ़ाइल", "फ़ाइल अपलोड करो" | "ఫైల్", "ఫైల్ అప్‌లోడ్ చేయండి" |
| Open a named file | "the CBC report in Downloads" | "डाउनलोड्स में CBC रिपोर्ट" | "డౌన్‌లోడ్స్‌లో CBC రిపోర్ట్" |
| Use the camera / take the photo | "use the camera" → "capture" | "कैमरा" → "फोटो लो" | "కెమెరా" → "తీయి" |
| Learn about a disease | "tell me about dengue" | "डेंगू के बारे में बताओ" | "డెంగ్యూ గురించి చెప్పండి" |
| Hear the results | "read the results" | "पढ़कर सुनाओ" | "చదివి వినిపించు" |
| Confirm / cancel | "yes" / "no" | "हाँ" / "नहीं" | "అవును" / "వద్దు" |
| Navigate | "back", "main menu" | "वापस", "होम" | "వెనక్కి", "మొదటికి" |
| Stop talking | "stop" | "रुको" | "ఆపు" |

> Browsers only open their own file dialogs after a real click, so a spoken "file" opens a native **Open file** window on the computer instead. It closes itself if you name the file by voice.

---

## 🧠 How it works

```mermaid
flowchart LR
    U([🧑‍⚕️ User]) -- voice / tap / upload --> FE

    subgraph FE [⚛️ React frontend]
        direction TB
        L[Language picker<br/>EN · HI · TE] --> A[Anatomy figure]
        A --> V[Voice loop<br/>VAD · barge-in · TTS]
        V --> S[Guided screens<br/>report · symptoms · photo]
        S --> R[Report view<br/>& translations]
    end

    FE -- REST /api --> BE

    subgraph BE [🐍 FastAPI backend]
        direction TB
        X[Extraction<br/>PyMuPDF → quality check → OCR]
        P[Lab parser<br/>+ source validation]
        G[Evidence search<br/>BM25 + PubMed]
        C[Voice commands<br/>validated tool calls]
        I[Photo analysis]
        T[Translation<br/>HI · TE]
        D[(SQLite / PostgreSQL<br/>encrypted files)]
        F[PDF report<br/>ReportLab]
    end

    BE <--> Q[[Groq<br/>gpt-oss · Whisper · vision]]
    G <--> M[[PubMed<br/>E-utilities]]
```

**Report pipeline:** upload → magic-byte check → encrypted storage → native text extraction → **text-quality inspection** → OCR only for weak pages → rule-based rows plus language-model structuring → **every value checked against its source line** → evaluation against the printed reference range (with flag fallback and unit guard) → evidence search → plain-language interpretation → doctor review → **PDF after approval**.

**Voice pipeline:** microphone → voice-activity detection → Whisper (in your language) → quick local commands, otherwise the assistant with **validated tool calls**: unknown actions or invalid arguments are rejected, and sensitive actions need a spoken "yes". The reply is shown and spoken in your language.

---

## ⚙️ Configuration

All settings live in `backend/.env` (start from [`backend/.env.example`](backend/.env.example)).

| Variable | Default | What it does |
|---|---|---|
| `GROQ_API_KEY` | *(empty)* | **Required.** Enables the assistant, interpretation, translation, speech recognition and photo analysis. |
| `GROQ_TEXT_MODEL` | `openai/gpt-oss-120b` | Main model for interpretation, symptoms, diseases, translation and voice replies. |
| `GROQ_FAST_MODEL` | `openai/gpt-oss-20b` | Quick extraction tasks, and the **automatic fallback** when the main model's daily limit is reached. |
| `GROQ_STT_MODEL` | `whisper-large-v3-turbo` | Speech-to-text. |
| `GROQ_VISION_MODEL` | `qwen/qwen3.8-27b` | Photo analysis of skin conditions and injuries. |
| `GROQ_TTS_MODEL` / `GROQ_TTS_VOICE` | `canopylabs/orpheus-v1-english` / `hannah` | Optional server voice (the browser voice is used by default). |
| `DATABASE_URL` | SQLite in `storage/` | e.g. `postgresql+psycopg://medlens:medlens@localhost:5432/medlens` |
| `STORAGE_DIR` | `storage/` | Database, encrypted uploads and generated PDFs. |
| `SECRET_KEY` | *(change me)* | Signs logins **and** encrypts stored files. Rotating it makes old files unreadable. |
| `DOCTOR_USERNAME` / `DOCTOR_PASSWORD` | `doctor` / `medlens123` | The single doctor login. **Change the password.** |
| `TOKEN_TTL_MINUTES` | `480` | Login session length. |
| `CORS_ORIGINS` | `http://localhost:5173,…` | Allowed frontend origins. |
| `REDACT_PHI_FOR_LLM` | `true` | Removes the patient's name before text leaves the server. |
| `PUBMED_API_KEY` / `PUBMED_EMAIL` | *(empty)* | Optional: higher PubMed rate limits. |
| `TESSERACT_CMD` | *(empty)* | Path to `tesseract.exe` if it is not on `PATH`. |
| `LOCAL_FILE_DIALOG` | `true` | Lets "file" by voice open a native Open-file window (localhost only). |
| `FILE_SEARCH_ROOTS` | *(empty)* | Extra folders (`;`-separated) that "open the … report" may search, besides Downloads/Desktop/Documents. |
| `MEDGEMMA_MODEL_PATH` / `MONAI_MODEL_PATH` | *(empty)* | Optional local imaging models. None are bundled or downloaded. |

---

## 📚 API reference

Interactive docs: **http://localhost:8000/docs** (Swagger UI). Everything except login and health needs `Authorization: Bearer <token>`.

<details>
<summary><b>All endpoints</b></summary>

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/login` | Doctor login → JWT |
| `GET` | `/api/health` | Server status and configuration flags |
| `GET` | `/api/models` · `/api/audit` | Imaging model registry · audit log |
| `GET/POST/PATCH` | `/api/patients[/{id}]` | List / create / update patients (incl. consent) |
| `GET` | `/api/patients/{id}/documents` | A patient's documents |
| `POST` | `/api/documents/upload` | Upload a report or image (validated, encrypted) |
| `POST` | `/api/files/find` · `/api/files/open` | Find a report on this computer by folder/name · open it |
| `POST` | `/api/documents/pick-local` · `/pick-local/cancel` | Open / auto-close the native file dialog |
| `GET/DELETE` | `/api/documents/{id}` | Document details · delete |
| `GET` | `/api/documents/{id}/page/{n}` · `/dicom` | Page image · DICOM frame with windowing |
| `POST` | `/api/documents/{id}/analyze` | Extract and structure lab values |
| `GET/PATCH` | `/api/analyses/{id}` | Read · edit values, notes, approve/reject |
| `POST` | `/api/analyses/{id}/interpret` | Plain-language interpretation with evidence |
| `GET` | `/api/analyses/{id}/compare` | Trends against earlier reports |
| `POST` | `/api/analyses/{id}/reanalyze` · `/report` | Re-run analysis · generate PDF (approved only) |
| `GET` | `/api/reports/{id}/download` | Download the PDF |
| `POST` | `/api/vision/analyze` | Photo of a disease / injury → prediction |
| `POST` | `/api/symptoms/analyze` · `/api/knowledge/disease` | Symptom check · disease information |
| `GET/POST` | `/api/knowledge/pubmed` · `/api/knowledge/ask` | PubMed search · evidence-based answer |
| `POST` | `/api/voice/transcribe` · `/speak` · `/command` | Speech-to-text · speech · voice command |
| `POST` | `/api/translate` | Translate a result object into Hindi or Telugu |
| `POST` | `/api/imaging/route` | Modality-aware routing for scans |

</details>

---

## 🗂️ Project structure

```text
Medi-Lens/
├── backend/
│   ├── app/
│   │   ├── main.py                     # FastAPI app
│   │   ├── api/routes.py               # all REST endpoints
│   │   ├── core/                       # config, database, JWT + encryption, audit
│   │   ├── models/entities.py          # patients, documents, analyses, reports, evidence, audit
│   │   ├── schemas/api.py              # request models
│   │   └── services/
│   │       ├── documents/              # extractor, text_quality, lab_parser, analysis, storage,
│   │       │                           # file_finder (voice file search), local_picker (native dialog)
│   │       ├── ocr/engine.py           # OpenCV preprocessing + Tesseract
│   │       ├── llm/groq_client.py      # chat, JSON, tool calls, Whisper, fallback model, redaction
│   │       ├── rag/retriever.py        # chunking + BM25
│   │       ├── medical_knowledge/      # PubMed E-utilities, symptom checker, disease info
│   │       ├── vision/image_diagnosis.py   # photo of disease / injury
│   │       ├── translate.py            # Hindi / Telugu translation of results and UI text
│   │       ├── voice/assistant.py      # voice tools, validation, multilingual replies
│   │       ├── reports/pdf_report.py   # A4 PDF (ReportLab)
│   │       ├── dicom/ · router/        # DICOM viewing · imaging model routing
│   ├── tests/                          # 23 pytest tests
│   ├── requirements.txt · Dockerfile · .env.example
├── frontend/
│   ├── src/
│   │   ├── main.tsx                    # language picker → app
│   │   ├── SimpleApp.tsx               # guided voice-first app (all screens)
│   │   ├── i18n.tsx                    # languages, dictionary, page-wide translator
│   │   ├── hooks/useVoice.ts           # mic, VAD, Whisper, speech, barge-in, pause
│   │   ├── services/api.ts             # typed API client
│   │   └── components/                 # BodyHero (anatomy), VoiceOrb, ReportResult, ImageDiagnosis,
│   │                                   # SymptomPanel, DiseasePanel, CareCards, Overlays, …
│   ├── package.json · vite.config.ts · Dockerfile · nginx.conf
├── docs/screenshots/                   # images used in this README
├── docker-compose.yml
└── LICENSE
```

**Tech stack:**
- **Frontend:** React 19 · TypeScript · Vite 6 · Tailwind CSS 4 · Framer Motion · Lucide icons
- **Backend:** FastAPI · SQLAlchemy · PyMuPDF · OpenCV · Tesseract · pydicom · ReportLab · PyJWT · cryptography
- **Language and speech services:** Groq (gpt-oss, Whisper, Qwen vision) · PubMed E-utilities

---

## 🛠️ Troubleshooting

| Problem | Fix |
|---|---|
| **Page is blank** | Open the browser console (F12). A message like *"does not provide an export named …"* means a frontend file is out of sync; pull the latest code and restart `npm run dev`. |
| **"Assistant not set up"** chip | `GROQ_API_KEY` is empty or the backend wasn't restarted after editing `.env`. |
| **Replies or translations stop / stay English** | The Groq account hit its **daily token limit** (HTTP 429). MedLens switches to `GROQ_FAST_MODEL` automatically; otherwise wait for the reset or use another key. |
| **`DLL load failed … An Application Control policy has blocked this file`** (Windows) | **Smart App Control** is blocking Python packages such as `pydantic_core`. It is intermittent: retry after a while, or turn Smart App Control off in *Windows Security → App & browser control* (on some Windows versions it can't be turned back on without reinstalling). |
| **Backend changes don't take effect** | Restart the backend. The `--reload` watcher has been seen to hang on Windows, so run without it and restart manually. |
| **No Telugu voice** | Chrome usually has no Telugu voice; **Edge** includes one. Without a voice, replies are still shown as text. |
| **Mic or camera not working** | They require `localhost` or HTTPS, and permission in the browser's site settings. |
| **Scanned report gives no values** | Install Tesseract and set `TESSERACT_CMD` if it isn't on `PATH`. |
| **"Open file" window didn't appear** | It opens on the computer running the backend (check the taskbar). It only works on localhost (`LOCAL_FILE_DIALOG=true`). |

---

## 🖼️ Imaging models and validation status
No imaging models are bundled or downloaded. `model_router.py` lists candidates (MONAI `spleen_ct_segmentation`, `wholeBody_ct_segmentation`, `brats_mri_segmentation`, `lung_nodule_ct_detection`; MedGemma 4B) with model-card links. Until `MONAI_MODEL_PATH` / `MEDGEMMA_MODEL_PATH` point to downloaded weights on a suitable GPU, scan tasks report **"unsupported: no automated findings generated"**. Clinical validation data is not available, and no accuracy figures are claimed.

## 🏥 Before any clinical deployment
MedLens still needs independent clinical validation, a hospital security review (HTTPS/TLS, backups, retention), a data-processing agreement with the language-model provider, and the applicable regulatory review. Text sent to Groq has the patient's name removed, but other identifiers in free text may remain.

## 📄 License
Released under the [MIT License](LICENSE) © 2026 Nikhil Kumar Sah. The license covers the code only; it is not a certification for clinical use.

<div align="center">
<sub>Built with ❤️ for doctors and patients · English · हिन्दी · తెలుగు</sub>
</div>
