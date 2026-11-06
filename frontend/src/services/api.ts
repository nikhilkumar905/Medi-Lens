import type { Analysis, Doc, Health, Patient, RouteDecision, UploadKind, VoiceAction, Evidence, SymptomResult, DiseaseInfo, ImageDiagnosis } from '../types'

const TOKEN_KEY = 'medlens_token'
let token: string | null = sessionStorage.getItem(TOKEN_KEY)
let onUnauthorized: () => void = () => {}

export const auth = {
  get token() { return token },
  set(t: string | null) {
    token = t
    if (t) sessionStorage.setItem(TOKEN_KEY, t)
    else sessionStorage.removeItem(TOKEN_KEY)
  },
  onUnauthorized(fn: () => void) { onUnauthorized = fn },
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const res = await fetch(`/api${path}`, { ...init, headers })
  if (res.status === 401 && path !== '/auth/login') { auth.set(null); onUnauthorized() }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try { const j = await res.json(); msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail) } catch { /* not json */ }
    throw new ApiError(res.status, msg)
  }
  const ct = res.headers.get('content-type') || ''
  return (ct.includes('application/json') ? res.json() : res.blob()) as Promise<T>
}

const json = (body: unknown) => JSON.stringify(body)

export const api = {
  login: (username: string, password: string) =>
    req<{ token: string; doctor: string }>('/auth/login', { method: 'POST', body: json({ username, password }) }),
  health: () => req<Health>('/health'),

  patients: () => req<Patient[]>('/patients'),
  createPatient: (p: Partial<Patient>) => req<Patient>('/patients', { method: 'POST', body: json(p) }),
  updatePatient: (id: number, p: Partial<Patient>) => req<Patient>(`/patients/${id}`, { method: 'PATCH', body: json(p) }),
  patientDocs: (id: number) => req<Doc[]>(`/patients/${id}/documents`),

  document: (id: number) => req<Doc>(`/documents/${id}`),
  pageImage: (id: number, page: number) => req<Blob>(`/documents/${id}/page/${page}`),
  dicomFrame: (id: number, frame: number, center?: number, width?: number) => {
    const q = new URLSearchParams({ frame: String(frame) })
    if (center !== undefined) q.set('center', String(center))
    if (width !== undefined) q.set('width', String(width))
    return req<Blob>(`/documents/${id}/dicom?${q}`)
  },

  pickLocal: (category: UploadKind, patient_id: number | null, location?: string) =>
    req<Doc & { cancelled?: boolean }>('/documents/pick-local', { method: 'POST', body: json({ category, patient_id, location }) }),
  /** Close the native file dialog opened by pickLocal (the file was chosen another way). */
  cancelPick: () => req<{ closed: boolean }>('/documents/pick-local/cancel', { method: 'POST' }),
  findFiles: (location?: string, query?: string) =>
    req<FindResult>('/files/find', { method: 'POST', body: json({ location, query }) }),
  openFound: (token: string, category: UploadKind = 'report', patient_id: number | null = null) =>
    req<Doc>('/files/open', { method: 'POST', body: json({ token, category, patient_id }) }),
  analyze: (docId: number) => req<Analysis>(`/documents/${docId}/analyze`, { method: 'POST' }),
  analysis: (id: number) => req<Analysis>(`/analyses/${id}`),
  interpret: (id: number, question?: string) => req<Analysis>(`/analyses/${id}/interpret`, { method: 'POST', body: json({ question }) }),
  compare: (id: number) => req<CompareResult>(`/analyses/${id}/compare`),
  updateAnalysis: (id: number, body: object) => req<Analysis>(`/analyses/${id}`, { method: 'PATCH', body: json(body) }),
  reanalyze: (id: number) => req<Analysis>(`/analyses/${id}/reanalyze`, { method: 'POST' }),
  generateReport: (id: number) => req<{ id: number; version: number }>(`/analyses/${id}/report`, { method: 'POST' }),
  downloadReport: (id: number) => req<Blob>(`/reports/${id}/download`),

  route: (body: { document_id?: number; modality: string; body_part?: string }) =>
    req<RouteDecision>('/imaging/route', { method: 'POST', body: json(body) }),

  transcribe: (audio: Blob, language?: string) => {
    const fd = new FormData()
    fd.append('audio', audio, 'speech.webm')
    if (language) fd.append('language', language)
    return req<{ text: string; uncertain: boolean; language: string | null }>('/voice/transcribe', { method: 'POST', body: fd })
  },
  speak: (text: string) => req<Blob>('/voice/speak', { method: 'POST', body: json({ text }) }),
  command: (text: string, history: { role: string; content: string }[], context: object, language: string = 'en') =>
    req<{ reply: string; actions: VoiceAction[]; errors: string[] }>('/voice/command', { method: 'POST', body: json({ text, history, context, language }) }),

  symptoms: (text: string, patient_id?: number | null, analysis_id?: number | null) =>
    req<SymptomResult>('/symptoms/analyze', { method: 'POST', body: json({ text, patient_id, analysis_id }) }),
  ask: (question: string, patient_id?: number | null) =>
    req<{ answer: string; evidence: Evidence[]; warnings: string[]; model: string }>('/knowledge/ask', { method: 'POST', body: json({ question, patient_id }) }),
  disease: (disease: string) => req<DiseaseInfo>('/knowledge/disease', { method: 'POST', body: json({ disease }) }),

  analyzePhoto: (image: Blob, filename: string, body_part?: string | null, notes?: string) => {
    const fd = new FormData()
    fd.append('image', image, filename)
    if (body_part) fd.append('body_part', body_part)
    if (notes?.trim()) fd.append('notes', notes.trim())
    return req<ImageDiagnosis>('/vision/analyze', { method: 'POST', body: fd })
  },
  translate: (language: 'hi' | 'te', data: object) =>
    req<{ language: string; data: unknown }>('/translate', { method: 'POST', body: json({ language, data }) }),
}

/** Downscale a photo in the browser (max 1280 px, JPEG) so it uploads fast and fits the vision model's limit. */
export async function shrinkImage(file: Blob, max = 1280): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('This file is not an image the browser can open. Use a JPG, PNG or WEBP photo.'))
      i.src = url
    })
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.max(32, Math.round(img.naturalWidth * scale))
    c.height = Math.max(32, Math.round(img.naturalHeight * scale))
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return await new Promise<Blob>((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new Error('Could not process the image'))), 'image/jpeg', 0.88))
  } finally { URL.revokeObjectURL(url) }
}

export interface CompareResult {
  available: boolean
  message?: string
  previous_count?: number
  comparisons?: { test_name: string; trend: string | null; change?: number; note?: string;
    points: { date: string; result: string; unit: string | null; status: string; current: boolean; document: string }[] }[]
}

/** Upload with progress + cancellation (XHR supports upload progress, fetch does not). */
export function uploadDocument(file: File | Blob, filename: string, category: UploadKind, patientId: number | null,
  onProgress: (pct: number) => void, forceOcr = false): { promise: Promise<Doc>; cancel: () => void } {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<Doc>((resolve, reject) => {
    const fd = new FormData()
    fd.append('file', file, filename)
    fd.append('category', category)
    if (patientId) fd.append('patient_id', String(patientId))
    if (forceOcr) fd.append('force_ocr', 'true')
    xhr.open('POST', '/api/documents/upload')
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => {
      let body: { detail?: string } & Doc
      try { body = JSON.parse(xhr.responseText) } catch { body = { detail: xhr.statusText } as never }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body)
      else reject(new ApiError(xhr.status, body.detail || 'Upload failed'))
    }
    xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'))
    xhr.onabort = () => reject(new ApiError(-1, 'Upload cancelled'))
    xhr.send(fd)
  })
  return { promise, cancel: () => xhr.abort() }
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export interface FoundFile { token: string; name: string; folder: string; size_bytes: number; modified: number; score: number }
export interface FindResult { folder: string; searched?: string[]; candidates: FoundFile[]; confident?: boolean; error?: string }
