"""Thin wrapper over the Groq SDK: chat, JSON-mode chat, tool calls, speech-to-text."""
import json
import re

from app.core.config import get_settings


class LLMNotConfigured(RuntimeError):
    pass


class LLMError(RuntimeError):
    pass


def _client():
    s = get_settings()
    if not s.llm_configured:
        raise LLMNotConfigured("GROQ_API_KEY is not set on the backend. Add it to backend/.env and restart.")
    from groq import Groq

    return Groq(api_key=s.groq_api_key, timeout=60)


def chat(messages: list[dict], model: str | None = None, temperature: float = 0.2,
         max_tokens: int = 1500, json_mode: bool = False, tools: list | None = None,
         tool_choice: str | None = None, reasoning_effort: str | None = "low"):
    s = get_settings()
    messages = _with_wording_rule(messages)
    kwargs = dict(model=model or s.groq_text_model, messages=messages,
                  temperature=temperature, max_tokens=max_tokens)
    # gpt-oss models reason before answering; keep it short so the budget goes to the answer
    if "gpt-oss" in kwargs["model"] and reasoning_effort:
        kwargs["reasoning_effort"] = reasoning_effort
    if json_mode:
        kwargs["response_format"] = {"type": "json_object"}
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = tool_choice or "auto"
    try:
        resp = _client().chat.completions.create(**kwargs)
    except LLMNotConfigured:
        raise
    except Exception as e:  # network / API errors are surfaced, never hidden
        # The big model has its own daily token quota; when it is used up, fall back to the fast model once.
        fallback = s.groq_fast_model
        if _is_rate_limit(e) and fallback and kwargs["model"] == s.groq_text_model and fallback != kwargs["model"]:
            kwargs["model"] = fallback
            try:
                resp = _client().chat.completions.create(**kwargs)
                return resp.choices[0].message, kwargs["model"]
            except Exception as e2:
                raise LLMError(f"Groq request failed: {e2}") from e2
        raise LLMError(f"Groq request failed: {e}") from e
    return resp.choices[0].message, kwargs["model"]


WORDING_RULE = ("Wording rule: never describe yourself, this app or the output as \"AI\", \"artificial intelligence\", "
                "a \"model\", \"language model\" or \"chatbot\" in any language. Refer to yourself as MedLens or "
                "\"the assistant\" and to the output as an analysis, prediction or interpretation. If the user sincerely "
                "asks whether you are a human or what you are, answer honestly that you are an automated software "
                "assistant, not a human, and never deny being automated.")


def _with_wording_rule(messages: list[dict]) -> list[dict]:
    """Append the product wording rule to the first system message (or add one)."""
    out = list(messages)
    if out and out[0].get("role") == "system" and isinstance(out[0].get("content"), str):
        out[0] = {**out[0], "content": out[0]["content"] + "\n\n" + WORDING_RULE}
    else:
        out.insert(0, {"role": "system", "content": WORDING_RULE})
    return out


def _is_rate_limit(e: Exception) -> bool:
    return getattr(e, "status_code", None) == 429 or "rate_limit" in str(e) or "Error code: 429" in str(e)


def chat_json(messages: list[dict], **kw) -> tuple[dict, str]:
    msg, model = chat(messages, json_mode=True, **kw)
    return parse_json(msg.content or "{}"), model


def parse_json(content: str) -> dict:
    """Parse a model reply as a JSON object, tolerating code fences or text around it."""
    try:
        out = json.loads(content)
        if isinstance(out, dict):
            return out
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{.*\}", content, re.S)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            pass
    raise LLMError("Model did not return valid JSON")


def transcribe(audio: bytes, filename: str, language: str | None = None, prompt: str | None = None) -> dict:
    """Speech-to-text. `prompt` primes Whisper with the app's vocabulary so short commands
    ("file", "upload a file") are not misheard as "fine" or "pail"."""
    s = get_settings()
    kwargs = dict(file=(filename, audio), model=s.groq_stt_model, response_format="verbose_json",
                  language=language, temperature=0.0)
    if prompt:
        kwargs["prompt"] = prompt
    try:
        resp = _client().audio.transcriptions.create(**kwargs)
    except LLMNotConfigured:
        raise
    except Exception as e:
        raise LLMError(f"Groq transcription failed: {e}") from e
    segs = getattr(resp, "segments", None) or []
    # avg_logprob / no_speech_prob let us detect uncertain recognition
    def _get(seg, key, default):
        return seg.get(key, default) if isinstance(seg, dict) else getattr(seg, key, default)

    avg_logprob = (sum(_get(x, "avg_logprob", 0) for x in segs) / len(segs)) if segs else None
    no_speech = max((_get(x, "no_speech_prob", 0) for x in segs), default=None)
    return {"text": (resp.text or "").strip(), "language": getattr(resp, "language", None),
            "avg_logprob": avg_logprob, "no_speech_prob": no_speech, "model": s.groq_stt_model}


def speak(text: str) -> bytes:
    """Natural-sounding speech via Groq TTS (Orpheus). Returns WAV bytes."""
    s = get_settings()
    try:
        resp = _client().audio.speech.create(model=s.groq_tts_model, voice=s.groq_tts_voice,
                                             input=text, response_format="wav")
        return resp.read()
    except LLMNotConfigured:
        raise
    except Exception as e:
        raise LLMError(f"Groq TTS failed: {e}") from e


def redact(text: str, names: list[str | None]) -> str:
    """Remove the patient's name(s) before sending text to an external LLM."""
    if not get_settings().redact_phi_for_llm:
        return text
    for n in names:
        if n and len(n.strip()) > 2:
            for part in {n.strip(), *[p for p in n.split() if len(p) > 2 and p.lower() not in ("mr", "mrs", "ms", "dr")]}:
                text = re.sub(re.escape(part), "[PATIENT]", text, flags=re.IGNORECASE)
    return text


def as_list(v) -> list[str]:
    """LLMs sometimes return a list field as one string; normalise to a list of short strings."""
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip()]
    if isinstance(v, str) and v.strip():
        parts = re.split(r"\s*(?:;|\n|•|(?<=[a-z\)])\.\s+(?=[A-Z])|,\s+(?=[A-Z]))\s*", v.strip())
        if len(parts) == 1 and v.count(",") >= 2:  # plain comma list: "CBC, iron studies, or B12 levels"
            parts = re.split(r",\s*(?:and\s+|or\s+)?", v.strip())
        return [p.strip(" .-") for p in parts if p.strip(" .-")]
    return []
