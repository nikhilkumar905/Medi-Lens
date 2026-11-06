"""Model router: decides which (if any) model may process a given input.

Image-analysis models (MONAI bundles, MedGemma) are only used when explicitly
configured and present on disk. Nothing is downloaded automatically. If no
compatible model exists the router returns an explicit "unsupported" decision —
the application never fabricates image findings.
"""
import os

from app.core.config import get_settings

# Candidate pretrained models (documented, NOT bundled). Each entry is only "available"
# if its weights are configured locally.
CANDIDATES = {
    ("ct", "spleen"): {"name": "MONAI spleen_ct_segmentation", "task": "Spleen segmentation (3D CT)",
                       "source": "https://github.com/Project-MONAI/model-zoo/tree/dev/models/spleen_ct_segmentation"},
    ("ct", "abdomen"): {"name": "MONAI wholeBody_ct_segmentation", "task": "Multi-organ segmentation (CT)",
                        "source": "https://github.com/Project-MONAI/model-zoo/tree/dev/models/wholeBody_ct_segmentation"},
    ("mri", "brain"): {"name": "MONAI brats_mri_segmentation", "task": "Brain tumour sub-region segmentation (multimodal MRI)",
                       "source": "https://github.com/Project-MONAI/model-zoo/tree/dev/models/brats_mri_segmentation"},
    ("ct", "lungs"): {"name": "MONAI lung_nodule_ct_detection", "task": "Lung nodule detection (CT)",
                      "source": "https://github.com/Project-MONAI/model-zoo/tree/dev/models/lung_nodule_ct_detection"},
    ("xray", "chest"): {"name": "MedGemma 4B (multimodal)", "task": "Experimental chest X-ray understanding",
                        "source": "https://github.com/google-health/medgemma"},
    ("xray", "lungs"): {"name": "MedGemma 4B (multimodal)", "task": "Experimental chest X-ray understanding",
                        "source": "https://github.com/google-health/medgemma"},
    ("photo", "skin"): {"name": "MedGemma 4B (multimodal)", "task": "Experimental dermatology image understanding",
                        "source": "https://github.com/google-health/medgemma"},
}

DOCUMENT_TYPES = {"application/pdf", "text/plain",
                  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}


def _configured(name: str) -> bool:
    s = get_settings()
    path = s.medgemma_model_path if "MedGemma" in name else s.monai_model_path
    return bool(path) and os.path.exists(path)


def route(modality: str, body_part: str | None = None) -> dict:
    modality = (modality or "").lower()
    if modality in ("report", "document", "previous"):
        return {"supported": True, "pipeline": "document-extraction", "model": "PyMuPDF/Tesseract + Groq LLM"}
    if modality == "text":
        return {"supported": True, "pipeline": "llm", "model": get_settings().groq_text_model}
    part = (body_part or "").lower()
    cand = CANDIDATES.get((modality, part))
    if cand and _configured(cand["name"]):
        return {"supported": True, "pipeline": "imaging-model", **cand,
                "validation": "Clinical validation data not available."}
    reason = (f"No validated {modality.upper()} model for '{part or 'this region'}' is configured on this server."
              if modality in ("xray", "ct", "mri", "ultrasound", "photo") else f"Unknown modality '{modality}'.")
    return {
        "supported": False,
        "pipeline": "viewer-only" if modality in ("xray", "ct", "mri", "ultrasound", "photo") else None,
        "reason": reason,
        "candidate": cand,
        "message": reason + " The image can be viewed and its metadata inspected, but no automated findings will be "
                   "generated. Configure MONAI_MODEL_PATH / MEDGEMMA_MODEL_PATH on a suitable GPU server to enable it.",
    }


def registry() -> list[dict]:
    return [{"modality": m, "body_part": b, **c, "available": _configured(c["name"]),
             "validation": "Clinical validation data not available."} for (m, b), c in CANDIDATES.items()]
