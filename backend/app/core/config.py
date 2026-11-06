"""Application configuration loaded from environment / .env file."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]  # backend/


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(BASE_DIR / ".env"), str(BASE_DIR.parent / ".env")),
        extra="ignore",
    )

    # --- Groq LLM ---
    groq_api_key: str = ""
    groq_text_model: str = "openai/gpt-oss-120b"
    groq_fast_model: str = "openai/gpt-oss-20b"
    groq_stt_model: str = "whisper-large-v3-turbo"
    groq_tts_model: str = "canopylabs/orpheus-v1-english"
    groq_tts_voice: str = "hannah"

    # --- Storage / DB ---
    database_url: str = f"sqlite:///{(BASE_DIR.parent / 'storage' / 'medlens.db').as_posix()}"
    storage_dir: str = str(BASE_DIR.parent / "storage")
    max_upload_mb: int = 25
    # open a native file dialog on this computer when the doctor says "upload file"
    local_file_dialog: bool = True
    # extra folders (";"-separated) the assistant may search by voice, besides your home folders
    file_search_roots: str = ""

    # --- Security ---
    secret_key: str = "change-me-in-production-please-use-a-long-random-string"
    doctor_username: str = "doctor"
    doctor_password: str = "medlens123"
    token_ttl_minutes: int = 480
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # --- Privacy ---
    # When true, patient names and identifiers are stripped before text is sent to Groq.
    redact_phi_for_llm: bool = True

    # --- Medical knowledge ---
    pubmed_api_key: str = ""
    pubmed_email: str = ""

    # --- OCR ---
    tesseract_cmd: str = ""  # e.g. C:\\Program Files\\Tesseract-OCR\\tesseract.exe

    # --- Optional local models (not downloaded automatically) ---
    medgemma_model_path: str = ""
    monai_model_path: str = ""

    @property
    def storage_path(self) -> Path:
        p = Path(self.storage_dir)
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def llm_configured(self) -> bool:
        return bool(self.groq_api_key.strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
