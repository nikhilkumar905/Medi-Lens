export type BBox = [number, number, number, number] | null

export interface Cell { text: string; bbox: BBox; low_confidence: boolean }
export interface Line { text: string; cells: Cell[]; bbox: BBox; low_confidence: boolean }
export interface Page {
  page: number
  method: string
  quality: { char_count: number; reliable: boolean; score: number; issues: string[] } | null
  warnings: string[]
  lines: Line[]
  text: string
  size: [number, number] | null
}
export interface Extraction { kind: string; pages: Page[]; error?: string; dicom?: Record<string, unknown> & { frames?: number } }

export interface Doc {
  id: number
  filename: string
  content_type: string
  category: string
  size_bytes: number
  status: string
  patient_id: number | null
  created_at: string
  latest_analysis_id: number | null
  review_status: string | null
  extraction?: Extraction
}

export interface LabRow {
  test_name: string
  result: string
  unit: string | null
  reference_interval: string | null
  flag: string | null
  evaluation: { status: string; note: string }
  page: number
  line_index: number
  bbox: BBox
  verification: string
  source_line: string | null
}

export interface Evidence {
  id: string
  source_type: 'pubmed' | 'document'
  source_id: string
  title: string | null
  page: number | null
  meta: { pmid?: string; authors?: string[]; journal?: string; year?: string; doi?: string; url?: string } | null
  text: string
}

export interface Interpretation {
  summary?: string
  abnormal_findings?: { test: string; explanation: string; evidence: string[] }[]
  interpretation?: string
  differential_considerations?: { condition: string; likelihood?: string; rationale: string; evidence: string[] }[]
  spoken_summary?: string
  suggested_further_evaluation?: string[]
  limitations?: string[]
  evidence?: Evidence[]
  model?: string
  generated_at?: string
  question?: string | null
  severity?: Severity
  severity_reason?: string
  key_points?: string[]
  plain_findings?: { test: string; status: string; meaning: string }[]
  precautions?: string[]
  avoid?: string[]
  lifestyle?: string[]
  see_doctor_if?: string[]
}

export type Severity = 'normal' | 'mild' | 'moderate' | 'serious' | 'varies'

export interface DiseaseInfo {
  input: string
  name: string
  overview: string
  severity?: Severity
  symptoms: string[]
  causes: string[]
  risk_factors: string[]
  prevention: string[]
  precautions: string[]
  avoid: string[]
  diagnostic_tests: string[]
  see_doctor_if: string[]
  spoken_summary?: string
  evidence: Evidence[]
  warnings: string[]
  limitations: string[]
  model: string
}

export interface Analysis {
  id: number
  document_id: number
  report_type: string | null
  structured: {
    patient: Record<string, string | null>
    report_type: string
    report_type_candidates: { type: string; matched_terms: string[] }[]
    rows: LabRow[]
    observations: string[]
    structuring_method: string
    warnings: string[]
    model: string | null
  }
  interpretation: Interpretation | null
  model_name: string | null
  review_status: 'pending' | 'approved' | 'rejected'
  doctor_notes: string | null
  created_at: string
  updated_at: string | null
  reports: { id: number; version: number; created_at: string }[]
}

export interface Patient {
  id: number
  name: string
  age: string | null
  gender: string | null
  mrn: string | null
  consent_ai_processing: boolean
  notes: string | null
  document_count: number
}

export interface Health {
  llm_configured: boolean
  llm_model: string
  stt_model: string
  ocr_available: boolean
  phi_redaction: boolean
  local_file_dialog?: boolean
}

export interface VoiceAction { name: string; args: Record<string, string>; requires_confirmation: boolean }

export interface RouteDecision {
  supported: boolean
  pipeline?: string | null
  model?: string
  name?: string
  task?: string
  reason?: string
  message?: string
  candidate?: { name: string; task: string; source: string } | null
  dicom?: Record<string, unknown> | null
  validation?: string
}

export type UploadKind = 'report' | 'xray' | 'ct' | 'mri' | 'ultrasound' | 'photo' | 'previous'

export interface SymptomResult {
  input: string
  extracted: { symptoms?: { name: string; details: string | null }[]; age?: string | null; sex?: string | null; duration?: string | null; context?: string | null }
  possible_conditions?: { condition: string; likelihood: string; reasoning: string; evidence: string[] }[]
  red_flags?: string[]
  recommended_evaluation?: string[]
  follow_up_questions?: string[]
  spoken_summary?: string
  severity?: Severity
  causes?: string[]
  prevention?: string[]
  precautions?: string[]
  avoid?: string[]
  see_doctor_if?: string[]
  evidence: Evidence[]
  warnings: string[]
  limitations: string[]
  model: string
}

export interface ImageDiagnosis {
  is_medical_image: boolean
  image_quality: 'good' | 'fair' | 'poor'
  quality_issue?: string | null
  kind?: 'disease' | 'injury' | 'unclear'
  observations: string[]
  possible_conditions: { condition: string; likelihood: string; reasoning: string; evidence: string[] }[]
  severity?: Severity
  severity_reason?: string
  symptoms: string[]
  causes: string[]
  precautions: string[]
  home_care: string[]
  avoid: string[]
  prevention: string[]
  see_doctor_if: string[]
  recommended_tests: string[]
  spoken_summary?: string
  body_part?: string | null
  limitations: string[]
  model: string
  generated_at?: string
}
