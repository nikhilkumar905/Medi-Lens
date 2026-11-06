"""Photo-based triage for visible conditions (skin disease, wounds, injuries, swelling, eye redness ...).

A multimodal Groq model looks at the photo and returns possible conditions plus plain-language care advice.
This is decision support only: the output is a list of possibilities, never a diagnosis.
"""
import base64
import re
from datetime import datetime, timezone

from app.core.config import get_settings
from app.services.llm import groq_client as llm

MAX_IMAGE_BYTES = 3_500_000  # Groq rejects base64 images above ~4 MB

VISION_PROMPT = """You are a careful clinical decision-support assistant. You are shown a photo that a doctor or
patient took of a visible health problem (for example a skin lesion, rash, wound, burn, bite, bruise, swelling,
eye redness, nail or mouth problem, or an injured limb). Study the image closely and return ONLY a JSON object:
{"is_medical_image": bool,
 "image_quality": "good"|"fair"|"poor",
 "quality_issue": str|null,
 "kind": "disease"|"injury"|"unclear",
 "observations": [str],
 "possible_conditions": [{"condition": str, "likelihood": "more likely"|"possible"|"less likely", "reasoning": str}],
 "severity": "mild"|"moderate"|"serious",
 "severity_reason": str,
 "symptoms": [str],
 "causes": [str],
 "precautions": [str],
 "home_care": [str],
 "avoid": [str],
 "prevention": [str],
 "see_doctor_if": [str],
 "recommended_tests": [str],
 "spoken_summary": str}
Rules:
- "observations": 3-6 objective visual findings (colour, size relative to the body part, borders, texture,
  distribution, discharge, swelling, deformity). Describe only what is visible.
- "possible_conditions": 2-5 possibilities ordered by likelihood, chosen by sound clinical reasoning (include a
  can't-miss condition when relevant). Qualitative likelihood words only - no percentages. These are
  possibilities, never a diagnosis.
- "symptoms": symptoms the person typically feels with the top possibilities (itching, pain, fever ...).
- Every other list: 3-5 items, each ONE short plain-language sentence (max ~15 words).
- "home_care": safe first-aid / self-care steps. Never prescribe prescription drugs or doses.
- "see_doctor_if": warning signs that need prompt medical care.
- "recommended_tests": examinations or tests a doctor may use to confirm (e.g. dermoscopy, X-ray, swab culture).
- "spoken_summary": 2-3 warm, natural sentences for reading aloud (no lists, no markdown).
- If the photo is not a medical/body image, set "is_medical_image": false, explain in "quality_issue", and leave
  the lists empty. If it is too blurry or dark to judge, set "image_quality": "poor" and say so in
  "quality_issue"; still give cautious possibilities only if something is discernible.
- If the person's notes conflict with the photo, trust the photo and mention the conflict in "quality_issue"."""

LIST_KEYS = ("observations", "symptoms", "causes", "precautions", "home_care", "avoid", "prevention",
             "see_doctor_if", "recommended_tests")


def detect_image_type(data: bytes) -> str | None:
    """Return the MIME type from the file's magic bytes, or None if it is not a supported image."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def analyze_image(data: bytes, mime: str, body_part: str | None = None, notes: str | None = None) -> dict:
    s = get_settings()
    context = []
    if body_part:
        context.append(f"Body area selected: {body_part}.")
    if notes:
        context.append(f"Notes from the user: {notes.strip()[:800]}")
    url = f"data:{mime};base64,{base64.b64encode(data).decode()}"
    msg, model = llm.chat(
        [{"role": "system", "content": VISION_PROMPT},
         {"role": "user", "content": [
             {"type": "text", "text": " ".join(context) or "No extra notes. Analyse the photo."},
             {"type": "image_url", "image_url": {"url": url}},
         ]}],
        model=s.groq_vision_model, max_tokens=3000, temperature=0.2, reasoning_effort=None,
    )
    data_out = llm.parse_json(re.sub(r"<think>.*?</think>", "", msg.content or "", flags=re.S))

    for k in LIST_KEYS:
        data_out[k] = llm.as_list(data_out.get(k))
    conds = []
    for c in data_out.get("possible_conditions") or []:
        if not isinstance(c, dict) or not str(c.get("condition") or "").strip():
            continue
        if c.get("likelihood") not in ("more likely", "possible", "less likely"):
            c["likelihood"] = "possible"
        c["reasoning"] = str(c.get("reasoning") or "")
        c["evidence"] = []
        conds.append(c)
    data_out["possible_conditions"] = conds[:6]
    if data_out.get("severity") not in ("mild", "moderate", "serious"):
        data_out["severity"] = "moderate" if conds else None
    if data_out.get("image_quality") not in ("good", "fair", "poor"):
        data_out["image_quality"] = "fair"
    data_out["is_medical_image"] = bool(data_out.get("is_medical_image", bool(conds)))
    return {
        **data_out,
        "body_part": body_part,
        "notes": notes,
        "limitations": [
            "Prediction from a single photo, for decision support only. It is not a diagnosis.",
            "Photos miss texture, temperature, depth and history; a clinician must examine the patient.",
            "Clinical validation data not available.",
        ],
        "model": model,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
