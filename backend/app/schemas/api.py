from pydantic import BaseModel, Field


class LoginIn(BaseModel):
    username: str
    password: str


class PatientIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    age: str | None = None
    gender: str | None = None
    mrn: str | None = None
    consent_ai_processing: bool = False
    notes: str | None = None


class InterpretIn(BaseModel):
    question: str | None = Field(default=None, max_length=1000)


class RowEdit(BaseModel):
    test_name: str
    result: str
    unit: str | None = None
    reference_interval: str | None = None
    flag: str | None = None
    page: int | None = None
    line_index: int | None = None


class AnalysisUpdate(BaseModel):
    rows: list[RowEdit] | None = None
    doctor_notes: str | None = None
    review_status: str | None = Field(default=None, pattern="^(pending|approved|rejected)$")


class CommandIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    history: list[dict] = []
    context: dict = {}


class AskIn(BaseModel):
    question: str = Field(min_length=2, max_length=1000)
    patient_id: int | None = None
    use_pubmed: bool = True


class RouteIn(BaseModel):
    document_id: int | None = None
    modality: str
    body_part: str | None = None


class SymptomsIn(BaseModel):
    text: str = Field(min_length=2, max_length=3000)
    patient_id: int | None = None
    analysis_id: int | None = None


class DiseaseIn(BaseModel):
    disease: str = Field(min_length=2, max_length=200)
