"""Translate the human-readable text inside a result object (report interpretation, symptom check, disease
info, image prediction) into Hindi or Telugu, keeping the JSON shape, keys, enums and evidence IDs intact."""
import hashlib
import json
from collections import OrderedDict

from app.core.config import get_settings
from app.services.llm import groq_client as llm

LANGUAGES = {"hi": "Hindi (Devanagari script)", "te": "Telugu (Telugu script)"}

# Values under these keys are identifiers, enums or source material and must stay unchanged.
SKIP_KEYS = {
    "id", "evidence", "evidence_used", "likelihood", "severity", "status", "model", "generated_at", "input",
    "source_type", "source_id", "meta", "page", "image_quality", "kind", "is_medical_image", "review_status",
    "evaluation", "unit", "result", "reference_interval", "flag", "line_index", "bbox", "document_id",
    "analysis_id", "created_at", "updated_at", "filename", "question", "notes", "body_part",
    "test", "test_name", "preview",
}

PROMPT = """You are a professional medical translator. Translate each string in "items" from English into {lang}
for patients and their families. Rules:
- Return ONLY JSON: {{"items": [...]}} with exactly {n} strings, in the same order.
- Use simple, everyday words that a non-specialist understands; keep it warm and clear.
- Keep numbers, units (mg/dL, g/dL, %), lab test abbreviations (CBC, HbA1c, TSH, WBC), and citation tags like [E1]
  exactly as they are. You may add the common local name in brackets after a medical term when helpful.
- Keep anything in curly braces such as {{part}} or {{n}} exactly unchanged (these are placeholders).
- Do not add, drop or merge items. Do not add explanations."""

_CACHE: "OrderedDict[str, list[str]]" = OrderedDict()
_CACHE_MAX = 300
CHUNK = 60


def _collect(node, out: list[str], key: str | None = None):
    if key in SKIP_KEYS:
        return
    if isinstance(node, str):
        if node.strip() and any(c.isalpha() for c in node):
            out.append(node)
    elif isinstance(node, list):
        for x in node:
            _collect(x, out, None)
    elif isinstance(node, dict):
        for k, v in node.items():
            _collect(v, out, k)


def _replace(node, it, key: str | None = None):
    if key in SKIP_KEYS:
        return node
    if isinstance(node, str):
        return next(it) if node.strip() and any(c.isalpha() for c in node) else node
    if isinstance(node, list):
        return [_replace(x, it, None) for x in node]
    if isinstance(node, dict):
        return {k: _replace(v, it, k) for k, v in node.items()}
    return node


def _translate_chunk(items: list[str], lang: str) -> list[str]:
    s = get_settings()
    data, _ = llm.chat_json(
        [{"role": "system", "content": PROMPT.format(lang=LANGUAGES[lang], n=len(items))},
         {"role": "user", "content": json.dumps({"items": items}, ensure_ascii=False)}],
        model=s.groq_text_model, max_tokens=min(16000, 400 + sum(len(x) for x in items) * 4), temperature=0.1,
    )
    out = data.get("items")
    if not isinstance(out, list) or len(out) != len(items):
        raise llm.LLMError("Translation returned a different number of items; please try again.")
    return [str(x) if str(x).strip() else orig for x, orig in zip(out, items)]


def translate_strings(items: list[str], lang: str) -> list[str]:
    if lang not in LANGUAGES:
        raise ValueError(f"Unsupported language: {lang}")
    if not items:
        return []
    key = hashlib.sha256((lang + "\x00" + "\x01".join(items)).encode()).hexdigest()
    if key in _CACHE:
        _CACHE.move_to_end(key)
        return _CACHE[key]
    out: list[str] = []
    for i in range(0, len(items), CHUNK):
        out += _translate_chunk(items[i:i + CHUNK], lang)
    _CACHE[key] = out
    if len(_CACHE) > _CACHE_MAX:
        _CACHE.popitem(last=False)
    return out


def translate_object(obj, lang: str):
    """Translate every human-readable string value in obj; return a structurally identical copy."""
    strings: list[str] = []
    _collect(obj, strings)
    # translate each unique string once
    uniq = list(dict.fromkeys(strings))
    mapping = dict(zip(uniq, translate_strings(uniq, lang)))
    return _replace(obj, iter(mapping[x] for x in strings))
