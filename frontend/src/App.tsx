import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, BookOpen, Camera, FileSearch, FileText, Loader2, LogOut, ScanLine, Search, Stethoscope, Upload, X, Activity, History } from 'lucide-react'
import { api, auth, saveBlob, uploadDocument, ApiError, type CompareResult } from './services/api'
import type { Analysis, BBox, Doc, Evidence, Health, Patient, RouteDecision, SymptomResult, UploadKind, VoiceAction } from './types'
import SymptomPanel from './components/SymptomPanel'
import { useVoice } from './hooks/useVoice'
import AnatomyViewer, { BODY_PART_LABELS } from './components/AnatomyViewer'
import VoiceAssistant, { type ChatMsg } from './components/VoiceAssistant'
import ExtractionViewer from './components/ExtractionViewer'
import AnalysisPanel, { EvidenceList } from './components/AnalysisPanel'
import BodyInvestigation, { KIND_LABEL, RECOMMENDED } from './components/BodyInvestigation'
import PatientBar from './components/PatientBar'
import { CameraCapture, ConfirmDialog, Login, type CameraHandle } from './components/Overlays'

type Workflow = 'home' | 'report' | 'body' | 'knowledge' | 'symptoms'
const ACCEPT: Record<UploadKind, string> = {
  report: '.pdf,.jpg,.jpeg,.png,.docx,.txt', previous: '.pdf,.jpg,.jpeg,.png,.docx,.txt',
  xray: '.dcm,.dicom,.jpg,.jpeg,.png', ct: '.dcm,.dicom', mri: '.dcm,.dicom', ultrasound: '.dcm,.dicom,.jpg,.jpeg,.png', photo: '.jpg,.jpeg,.png',
}
const YES = /^(yes|yeah|yep|confirm|confirmed|ok|okay|sure|go ahead|do it|proceed)\b/i
const NO = /^(no|nope|cancel|don'?t|stop|never ?mind)\b/i

function greeting() {
  const h = new Date().getHours()
  const hi = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  return `${hi}, Doctor! How can I help you today?`
}

export default function App({ onSimple }: { onSimple?: () => void } = {}) {
  const [doctor, setDoctor] = useState<string | null>(auth.token ? 'doctor' : null)
  const [health, setHealth] = useState<Health | null>(null)
  const [backendDown, setBackendDown] = useState(false)
  const [patients, setPatients] = useState<Patient[]>([])
  const [patient, setPatient] = useState<Patient | null>(null)
  const [patientDocs, setPatientDocs] = useState<Doc[]>([])

  const [workflow, setWorkflow] = useState<Workflow>('home')
  const navStack = useRef<Workflow[]>([])
  const [kind, setKind] = useState<UploadKind>('report')
  const [upload, setUpload] = useState<{ name: string; pct: number; cancel: () => void } | null>(null)
  const [doc, setDoc] = useState<Doc | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [compare, setCompare] = useState<CompareResult | null>(null)
  const [tab, setTab] = useState<'original' | 'analysis'>('original')
  const [highlight, setHighlight] = useState<{ page: number; bbox: BBox } | null>(null)
  const [bodyPart, setBodyPart] = useState<string | null>(null)
  const [route, setRoute] = useState<RouteDecision | null>(null)
  const [knowledge, setKnowledge] = useState<{ q: string; answer: string; evidence: Evidence[]; warnings: string[] } | null>(null)
  const [symptoms, setSymptoms] = useState<SymptomResult | null>(null)
  const [symptomInput, setSymptomInput] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [camera, setCamera] = useState(false)
  const cameraRef = useRef<CameraHandle>(null)
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => void } | null>(null)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [thinking, setThinking] = useState(false)
  const [pulseUpload, setPulseUpload] = useState(false)
  const pendingUtterance = useRef<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const greeted = useRef(false)

  // mirror of state for async voice handlers
  const S = useRef({ doc, analysis, workflow, bodyPart, kind, patient, confirm, upload })
  S.current = { doc, analysis, workflow, bodyPart, kind, patient, confirm, upload }

  const notify = (text: string, k: 'error' | 'info' = 'info') => { setToast({ kind: k, text }); setTimeout(() => setToast(null), 6000) }
  const fail = (e: unknown) => { const m = e instanceof Error ? e.message : String(e); notify(m, 'error'); return m }

  const voice = useVoice({ onUtterance: (t, u) => onUtterance(t, u) })
  const say = useCallback((text: string, opts: { speak?: boolean } = {}) => {
    if (!text) return
    setMessages(m => [...m, { role: 'assistant', content: text }])
    if (opts.speak !== false) voice.speak(text)
  }, [voice])

  // ---------- bootstrap ----------
  useEffect(() => { auth.onUnauthorized(() => { setDoctor(null); voice.stop() }) }, [voice])
  useEffect(() => {
    const ping = () => api.health().then(h => { setHealth(h); setBackendDown(false) }).catch(() => setBackendDown(true))
    ping()
    const t = setInterval(ping, 20000)
    return () => clearInterval(t)
  }, [])
  const loadPatients = useCallback(() => { api.patients().then(setPatients).catch(() => {}) }, [])
  useEffect(() => { if (doctor) loadPatients() }, [doctor, loadPatients])
  useEffect(() => {
    if (patient) api.patientDocs(patient.id).then(setPatientDocs).catch(() => setPatientDocs([]))
    else setPatientDocs([])
  }, [patient, doc?.id, analysis?.id])

  const greet = () => {
    const first = !greeted.current
    greeted.current = true
    say(first ? greeting() : ['Hi again, Doctor. How can I help?', "I'm listening — what can I do for you?", 'Yes, Doctor? How can I help you?'][Math.floor(Math.random() * 3)])
  }

  // ---------- navigation ----------
  const go = (w: Workflow) => { if (w !== S.current.workflow) navStack.current.push(S.current.workflow); setWorkflow(w) }
  const back = () => { setWorkflow(navStack.current.pop() || 'home') }

  // ---------- uploads ----------
  const openPicker = (k: UploadKind) => {
    setKind(k)
    if (S.current.workflow !== 'body' || k === 'report' || k === 'previous') { if (k === 'report' || k === 'previous') go('report') }
    const clicked = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive ?? false
    if (clicked && fileInput.current) {
      fileInput.current.accept = ACCEPT[k]
      fileInput.current.click()
      return
    }
    if (health?.local_file_dialog) { void pickNative(k); return }
    setPulseUpload(true)
    setTimeout(() => setPulseUpload(false), 4000)
  }

  /** Voice-triggered upload: backend opens a native file dialog on this computer. */
  const pickNative = async (k: UploadKind) => {
    setDoc(null); setAnalysis(null); setCompare(null); setRoute(null); setTab('original')
    setBusy('picking')
    try {
      const d = await api.pickLocal(k, S.current.patient?.id ?? null)
      setBusy(null)
      if (d.cancelled) { say('No problem, no file selected. Just say upload file when you are ready.'); return }
      afterUpload(d, d.filename, k)
    } catch (e) {
      setBusy(null)
      if (e instanceof ApiError && (e.status === 501 || e.status === 403)) {
        setPulseUpload(true); setTimeout(() => setPulseUpload(false), 6000)
        say("I can't open the file browser from here — just click the highlighted upload area and pick the file.")
      } else say(`Upload failed: ${fail(e)}`)
    }
  }

  const afterUpload = (d: Doc, name: string, k: UploadKind) => {
    setDoc(d)
    const warn = d.extraction?.pages?.flatMap(p => p.warnings) || []
    if (d.status === 'failed') say(`I could not extract this document: ${d.extraction?.error}`)
    else if (['report', 'previous'].includes(k)) {
      const usedOcr = d.extraction?.pages?.some(p => p.method.startsWith('ocr'))
      say(`Got it, I'm reading through ${name} now${usedOcr ? ' — it needed OCR, so give me a moment' : ''}.${warn.length ? " I noticed a few extraction warnings, I'll flag them." : ''}`)
      void runAnalyze(d, true)
    } else say(`${KIND_LABEL[k]} uploaded. Say "analyze the image" to check for a compatible model.`)
  }

  const doUpload = async (file: Blob, name: string, k: UploadKind) => {
    setDoc(null); setAnalysis(null); setCompare(null); setRoute(null); setTab('original')
    const u = uploadDocument(file, name, k, S.current.patient?.id ?? null, pct => setUpload(x => x && { ...x, pct }))
    setUpload({ name, pct: 0, cancel: u.cancel })
    try {
      const d = await u.promise
      afterUpload(d, name, k)
      return d
    } catch (e) {
      if (e instanceof ApiError && e.status === -1) say('Upload cancelled.', { speak: false })
      else say(`Upload failed: ${fail(e)}`)
    } finally { setUpload(null) }
  }

  // ---------- analysis actions ----------
  const runAnalyze = async (d = S.current.doc, auto = false) => {
    if (!d) { say("Sure! Just say upload file and I'll open your file browser so you can pick the report."); return }
    if (!d.extraction?.pages?.length) { say('This file has no extractable text. For scans, use the body-part investigation workflow.'); return }
    setBusy('analyze')
    try {
      const a = await api.analyze(d.id)
      setAnalysis(a); setTab('analysis'); setCompare(null)
      S.current.analysis = a
      const abn = a.structured.rows.filter(r => ['high', 'low'].includes(r.evaluation.status))
      if (auto && health?.llm_configured && a.structured.rows.length) {
        setBusy(null)
        if (await runInterpret(undefined, a)) return
      }
      say(`Analysis complete. This looks like a ${a.structured.report_type}. I extracted ${a.structured.rows.length} values; ${abn.length} ${abn.length === 1 ? 'is' : 'are'} outside the report's reference interval${abn.length ? ': ' + abn.slice(0, 4).map(r => `${r.test_name} ${r.evaluation.status}`).join(', ') : ''}. Please review them.`)
    } catch (e) { say(`Analysis failed: ${fail(e)}`) } finally { setBusy(null) }
  }

  const runInterpret = async (question?: string, base?: Analysis): Promise<boolean> => {
    const a = base || S.current.analysis
    if (!a) { void runAsk(question || 'Explain the findings'); return false }
    setBusy('interpret')
    try {
      const r = await api.interpret(a.id, question)
      setAnalysis(r); setTab('analysis')
      say(r.interpretation?.spoken_summary || r.interpretation?.summary || 'Interpretation ready.')
      return true
    } catch (e) { say(`I couldn't generate the interpretation: ${fail(e)}`); return false } finally { setBusy(null) }
  }

  const runSymptoms = async (text: string) => {
    go('symptoms')
    setSymptomInput(text); setSymptoms(null); setBusy('symptoms')
    try {
      const r = await api.symptoms(text, S.current.patient?.id, S.current.analysis?.id)
      setSymptoms(r)
      say(r.spoken_summary || 'Here is what I think.')
    } catch (e) { say(`Sorry, I couldn't analyze those symptoms: ${fail(e)}`) } finally { setBusy(null) }
  }

  const runCompare = async () => {
    const a = S.current.analysis
    if (!a) { say('Analyze a report first, then I can compare it with previous reports.'); return }
    setBusy('compare')
    try {
      const c = await api.compare(a.id)
      setCompare(c); setTab('analysis')
      if (!c.available) say(c.message || 'No previous reports.')
      else {
        const ch = (c.comparisons || []).filter(x => x.trend && x.trend !== 'unchanged')
        say(`Compared with ${c.previous_count} previous report${c.previous_count === 1 ? '' : 's'}. ${ch.length ? ch.slice(0, 4).map(x => `${x.test_name} ${x.trend}`).join(', ') + '.' : 'No numeric changes in matching tests.'}`)
      }
    } catch (e) { say(fail(e)) } finally { setBusy(null) }
  }

  const saveAnalysis = async (body: object) => {
    const a = S.current.analysis
    if (!a) return
    try {
      const r = await api.updateAnalysis(a.id, body)
      setAnalysis(r)
      if ('review_status' in body) say(`Analysis marked as ${r.review_status}.`, { speak: false })
    } catch (e) { fail(e) }
  }

  const runReport = async () => {
    const a = S.current.analysis
    if (!a) { say('There is no analysis to report on yet.'); return }
    if (a.review_status !== 'approved') { say('The analysis must be reviewed and approved before I can generate the PDF report.'); return }
    setBusy('report')
    try {
      const r = await api.generateReport(a.id)
      setAnalysis(await api.analysis(a.id))
      say(`Report version ${r.version} generated. Say "download the report" to save it.`)
    } catch (e) { say(fail(e)) } finally { setBusy(null) }
  }

  const runDownload = async (reportId?: number) => {
    const a = S.current.analysis
    const id = reportId ?? a?.reports[a.reports.length - 1]?.id
    if (!id) { say('No PDF report has been generated yet.'); return }
    try { saveBlob(await api.downloadReport(id), `medlens_report_${a?.id}.pdf`); say('Report downloaded.', { speak: false }) } catch (e) { fail(e) }
  }

  const runRoute = async () => {
    const d = S.current.doc
    if (!d) { say('Please upload an image first.'); return }
    setBusy('route')
    try {
      const r = await api.route({ document_id: d.id, modality: S.current.kind, body_part: S.current.bodyPart || undefined })
      setRoute(r)
      say(r.supported ? `Routed to ${r.name || r.model}.` : r.message || 'This task is not supported.')
    } catch (e) { say(fail(e)) } finally { setBusy(null) }
  }

  const runAsk = async (q: string) => {
    go('knowledge')
    setBusy('ask')
    try {
      const r = await api.ask(q, S.current.patient?.id)
      setKnowledge({ q, ...r })
      say(r.answer)
    } catch (e) { say(fail(e)) } finally { setBusy(null) }
  }

  const readAloud = () => {
    const a = S.current.analysis
    if (!a) { say('There are no findings to read yet.'); return }
    const abn = a.structured.rows.filter(r => ['high', 'low'].includes(r.evaluation.status))
    const parts = [`${a.structured.report_type}.`,
      abn.length ? `Values outside reference: ${abn.map(r => `${r.test_name}, ${r.result} ${r.unit || ''}, ${r.evaluation.status}, reference ${r.reference_interval}`).join('; ')}.` : 'All extracted values with reference intervals are within range.',
      a.interpretation?.summary || '']
    say(parts.join(' '))
  }

  const selectPart = (p: string) => {
    setBodyPart(p); setRoute(null); go('body')
    if (S.current.doc && !['report', 'previous'].includes(S.current.kind)) setDoc(null)
    const recs = (RECOMMENDED[p] || []).map(k => KIND_LABEL[k]).join(', ')
    say(`${BODY_PART_LABELS[p]} selected. Which scan or report would you like to provide? Suitable inputs include ${recs}.`)
  }

  const cancelOp = () => {
    S.current.upload?.cancel()
    setBusy(null); setRoute(null)
    say('Current operation cancelled.', { speak: false })
  }

  const withConfirm = (title: string, message: string, run: () => void) => setConfirm({ title, message, run })

  // ---------- voice action dispatcher ----------
  const dispatch = (a: VoiceAction) => {
    const run = (): void => {
      switch (a.name) {
        case 'open_report_upload': return openPicker((a.args.kind as UploadKind) || 'report')
        case 'activate_camera': setCamera(true); return
        case 'capture_image': cameraRef.current ? cameraRef.current.capture() : say('The camera is not open. Say "open the camera" first.'); return
        case 'select_body_part': return selectPart(a.args.body_part)
        case 'analyze_medical_document': void runAnalyze(); return
        case 'analyze_medical_image': void runRoute(); return
        case 'compare_previous_reports': void runCompare(); return
        case 'analyze_symptoms': void runSymptoms(a.args.symptoms); return
        case 'retrieve_medical_evidence': void runAsk(a.args.query); return
        case 'explain_medical_findings': void runInterpret(a.args.question); return
        case 'show_original_document': if (S.current.doc) { go('report'); setTab('original') } else say('No document is open.'); return
        case 'generate_medical_report': void runReport(); return
        case 'download_medical_report': void runDownload(); return
        case 'read_results_aloud': return readAloud()
        case 'stop_speaking': return voice.stopSpeaking()
        case 'repeat_last_answer': return voice.repeat()
        case 'go_back': return back()
        case 'cancel_current_operation': return cancelOp()
      }
    }
    if (a.requires_confirmation) {
      const labels: Record<string, string> = { generate_medical_report: 'Generate PDF report', download_medical_report: 'Download report', cancel_current_operation: 'Cancel current operation' }
      withConfirm(labels[a.name] || 'Confirm', `Do you want me to ${labels[a.name]?.toLowerCase()}?`, run)
    } else run()
  }

  const handleCommand = async (text: string) => {
    setMessages(m => [...m, { role: 'user', content: text }])
    if (/^(stop( speaking)?|be quiet|silence)\.?$/i.test(text.trim())) { voice.stopSpeaking(); return }
    if (/^(repeat( that)?|say (that|it) again)\.?$/i.test(text.trim())) { voice.repeat(); return }
    setThinking(true)
    try {
      const st = S.current
      const ctx = {
        workflow: st.workflow, selected_body_part: st.bodyPart, document: st.doc?.filename || null,
        has_analysis: !!st.analysis, review_status: st.analysis?.review_status || null, patient_selected: !!st.patient,
        camera_open: camera,
      }
      const history = messages.filter(m => m.role !== 'system').slice(-8).map(m => ({ role: m.role, content: m.content }))
      const r = await api.command(text, history, ctx)
      if (r.reply) say(r.reply, { speak: !r.actions.some(x => ['stop_speaking', 'repeat_last_answer', 'read_results_aloud', 'retrieve_medical_evidence', 'explain_medical_findings'].includes(x.name)) })
      r.actions.forEach(dispatch)
    } catch (e) { say(`Sorry — ${fail(e)}`, { speak: true }) } finally { setThinking(false) }
  }

  function onUtterance(text: string, uncertain: boolean) {
    const t = text.trim().replace(/[.!?]+$/, '')
    const c = S.current.confirm
    if (c) {
      setMessages(m => [...m, { role: 'user', content: text }])
      if (YES.test(t)) { setConfirm(null); c.run() } else if (NO.test(t)) { setConfirm(null); say('Okay, cancelled.') }
      else say('Please say yes to confirm or no to cancel.')
      return
    }
    if (pendingUtterance.current) {
      const p = pendingUtterance.current
      pendingUtterance.current = null
      if (YES.test(t)) { void handleCommand(p); return }
    }
    if (uncertain) {
      pendingUtterance.current = text
      setMessages(m => [...m, { role: 'user', content: text, uncertain: true }])
      say(`I'm not sure I heard that correctly. Did you say: "${text}"? Say yes to continue, or repeat your request.`)
      return
    }
    void handleCommand(text)
  }

  const toggleMic = () => {
    if (voice.mic === 'off' || voice.mic === 'error') { void voice.start(); greet() } else voice.stop()
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) await doUpload(f, f.name, S.current.kind)
  }

  const onCapture = async (b: Blob) => {
    setCamera(false)
    const k = S.current.workflow === 'body' ? 'photo' : 'report'
    setKind(k)
    if (k === 'report') go('report')
    await doUpload(b, `camera_${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`, k)
  }

  const openDoc = async (d: Doc) => {
    try {
      const full = await api.document(d.id)
      setDoc(full); setKind(full.category as UploadKind); setCompare(null)
      setAnalysis(d.latest_analysis_id ? await api.analysis(d.latest_analysis_id) : null)
      setTab(d.latest_analysis_id ? 'analysis' : 'original'); go('report')
    } catch (e) { fail(e) }
  }

  if (!doctor) return <Login onLogin={d => { setDoctor(d); greeted.current = false }} />

  const llmReady = !!health?.llm_configured
  return (
    <div className="flex h-full flex-col">
      <input ref={fileInput} type="file" hidden onChange={onFile} />
      {/* header */}
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white"><Stethoscope size={20} /></div>
          <div className="leading-tight"><div className="font-bold text-slate-900">MedLens AI</div><div className="text-[11px] text-slate-500">Decision support · doctor review required</div></div>
        </div>
        <div className="mx-auto"><PatientBar patients={patients} current={patient} onSelect={setPatient} onChanged={loadPatients} /></div>
        <div className="flex items-center gap-1.5 text-[11px]">
          {backendDown ? <span className="chip bg-rose-100 text-rose-700">Backend offline</span> : <>
            <span className={`chip ${llmReady ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}><Activity size={11} />{llmReady ? `Groq · ${health?.llm_model}` : 'LLM not configured'}</span>
            <span className={`chip ${health?.ocr_available ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}><ScanLine size={11} />{health?.ocr_available ? 'OCR ready' : 'OCR not installed'}</span>
          </>}
          {onSimple && <button className="btn-ghost !px-2 !py-1 !text-xs" onClick={() => { voice.stop(); onSimple() }}>Simple view</button>}
          <button className="btn-ghost !px-2 !py-1" title="Sign out" onClick={() => { auth.set(null); voice.stop(); setDoctor(null) }}><LogOut size={14} /></button>
        </div>
      </header>

      {/* main */}
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[280px_1fr_330px]">
        <div className="hidden min-h-0 lg:block"><AnatomyViewer selected={bodyPart} onSelect={selectPart} /></div>

        <section className="card flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            {workflow !== 'home' && <button className="btn-ghost !p-1.5" onClick={back} title="Go back"><ArrowLeft size={16} /></button>}
            <h2 className="text-sm font-semibold text-slate-900">
              {workflow === 'home' ? 'Workflow' : workflow === 'report' ? 'Option 1 — Medical Report Analysis' : workflow === 'body' ? 'Option 2 — Body Part Investigation' : workflow === 'symptoms' ? 'Symptom Analysis' : 'Medical Evidence (RAG)'}
            </h2>
            {busy === 'picking' && (
              <div className="ml-auto flex items-center gap-2 rounded-lg bg-brand-50 px-2.5 py-1 text-xs text-brand-800">
                <Loader2 size={13} className="animate-spin" />File browser is open on your computer — choose the file (check the taskbar if you don't see it)
              </div>
            )}
            {upload && (
              <div className="ml-auto flex items-center gap-2 text-xs">
                <span className="max-w-[160px] truncate">{upload.name}</span>
                <div className="h-1.5 w-28 overflow-hidden rounded bg-slate-200"><div className="h-full bg-brand-500 transition-all" style={{ width: `${upload.pct}%` }} /></div>
                <span>{upload.pct < 100 ? `${upload.pct}%` : 'processing…'}</span>
                <button className="btn-ghost !p-1" onClick={upload.cancel} title="Cancel"><X size={13} /></button>
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto scroll-thin p-4">
            <AnimatePresence mode="wait">
              <motion.div key={workflow} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="h-full">
                {workflow === 'home' && (
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <button onClick={() => go('report')} className="card group p-6 text-left transition hover:border-brand-400 hover:shadow-md">
                        <FileSearch className="mb-3 text-brand-600" size={30} />
                        <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Option 1</div>
                        <div className="text-lg font-semibold">Medical Report Analysis</div>
                        <p className="mt-1 text-sm text-slate-500">Upload or scan lab reports (PDF, image, DOCX, TXT). Smart extraction with OCR fallback, structured values, RAG explanations, comparison and PDF reports.</p>
                        <p className="mt-3 text-xs text-slate-400">Say: “Analyze this report”</p>
                      </button>
                      <button onClick={() => { go('body'); say('Doctor, which body part would you like to investigate?') }} className="card group p-6 text-left transition hover:border-brand-400 hover:shadow-md">
                        <Stethoscope className="mb-3 text-brand-600" size={30} />
                        <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Option 2</div>
                        <div className="text-lg font-semibold">Body Part Investigation</div>
                        <p className="mt-1 text-sm text-slate-500">Select a region on the anatomy or by voice, then provide X-ray, CT, MRI, ultrasound, DICOM or clinical photos. Safe model routing.</p>
                        <p className="mt-3 text-xs text-slate-400">Say: “Investigate the lungs”</p>
                      </button>
                    </div>
                    <SymptomBox onSubmit={runSymptoms} busy={busy === 'symptoms'} disabled={!llmReady} />
                    <KnowledgeBox onAsk={runAsk} busy={busy === 'ask'} disabled={!llmReady} />
                    {patient && patientDocs.length > 0 && <DocList docs={patientDocs} onOpen={openDoc} />}
                  </div>
                )}

                {workflow === 'report' && (
                  <div className="flex h-full flex-col gap-4">
                    {!doc && (
                      <>
                        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                          {([['report', 'Upload medical report', FileText], ['camera', 'Scan using camera', Camera], ['xray', 'Upload X-ray', Upload], ['ct', 'Upload CT scan', Upload], ['mri', 'Upload MRI', Upload], ['previous', 'Upload previous report', History]] as const).map(([k, label, Icon]) => (
                            <button key={k} className="card flex items-center gap-3 p-3 text-left text-sm font-medium transition hover:border-brand-400"
                              onClick={() => k === 'camera' ? setCamera(true) : k === 'xray' || k === 'ct' || k === 'mri' ? (go('body'), openPicker(k)) : openPicker(k)}>
                              <Icon size={18} className="text-brand-600" />{label}
                            </button>
                          ))}
                        </div>
                        <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void doUpload(f, f.name, kind) }}
                          onClick={() => openPicker(kind)}
                          className={`flex flex-1 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition ${pulseUpload ? 'animate-pulse border-brand-500 bg-brand-50' : 'border-slate-300 hover:border-brand-400 hover:bg-brand-50/40'}`}>
                          <Upload className="mb-2 text-brand-500" size={32} />
                          <div className="font-medium">Drop a file here or click to choose</div>
                          <div className="mt-1 text-xs text-slate-500">PDF, JPG, PNG, DOCX, TXT, DICOM · max 25 MB · {KIND_LABEL[kind]}</div>
                          {pulseUpload && <div className="mt-2 text-xs text-brand-700">Your browser requires a click to open the file dialog — click here.</div>}
                        </div>
                        {patient && patientDocs.length > 0 && <DocList docs={patientDocs} onOpen={openDoc} />}
                      </>
                    )}
                    {doc && (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="mr-auto text-sm"><b>{doc.filename}</b> <span className="text-slate-400">· {(doc.size_bytes / 1024).toFixed(0)} KB · {doc.status}</span></div>
                          <div className="flex rounded-xl bg-slate-100 p-0.5 text-sm">
                            <button className={`rounded-lg px-3 py-1 ${tab === 'original' ? 'bg-white shadow' : ''}`} onClick={() => setTab('original')}>Original & extracted</button>
                            <button className={`rounded-lg px-3 py-1 ${tab === 'analysis' ? 'bg-white shadow' : ''}`} onClick={() => setTab('analysis')} disabled={!analysis}>Analysis</button>
                          </div>
                          {(busy === 'analyze' || busy === 'interpret') && <span className="flex items-center gap-1.5 text-xs text-brand-700"><Loader2 size={14} className="animate-spin" />{busy === 'analyze' ? 'Extracting values…' : 'Finding possible conditions…'}</span>}
                          {!analysis && <button className="btn-primary" onClick={() => runAnalyze()} disabled={busy === 'analyze'}>{busy === 'analyze' && <Loader2 size={15} className="animate-spin" />}Analyze document</button>}
                          <button className="btn-ghost" onClick={() => { setDoc(null); setAnalysis(null) }}>New upload</button>
                        </div>
                        <div className="min-h-[420px] flex-1">
                          {tab === 'original' || !analysis ? <ExtractionViewer doc={doc} highlight={highlight} onHighlight={setHighlight} /> : (
                            <div className="grid h-full gap-4 xl:grid-cols-[1fr_380px]">
                              <AnalysisPanel analysis={analysis} compare={compare} busy={busy} onInterpret={runInterpret} onCompare={runCompare} onSave={saveAnalysis}
                                onReanalyze={() => runAnalyze()} onGenerate={() => withConfirm('Generate PDF report', 'Generate a PDF from the approved analysis?', runReport)}
                                onDownload={runDownload} onRowSelect={setHighlight} />
                              <div className="hidden xl:block"><MiniSource doc={doc} highlight={highlight} /></div>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {workflow === 'body' && (bodyPart ? (
                  <BodyInvestigation part={bodyPart} doc={doc && !['report', 'previous'].includes(kind) ? doc : null} kind={kind} route={route} busy={busy}
                    onUpload={k => openPicker(k)} onCamera={() => setCamera(true)} onRoute={runRoute}
                    onLearn={() => runAsk(`Normal anatomy and function of the ${BODY_PART_LABELS[bodyPart].toLowerCase()}, and the most common conditions affecting it and how they are evaluated`)} />
                ) : (
                  <div className="py-10 text-center">
                    <Stethoscope className="mx-auto mb-3 text-brand-500" size={36} />
                    <p className="font-medium">Doctor, which body part would you like to investigate?</p>
                    <p className="mt-1 text-sm text-slate-500">Click a region on the anatomy, choose from the list, or say e.g. “Investigate the lungs”.</p>
                    <div className="mx-auto mt-4 flex max-w-lg flex-wrap justify-center gap-1.5">
                      {['brain', 'lungs', 'heart', 'liver', 'kidneys', 'spine', 'knees', 'skin'].map(p => <button key={p} className="btn-ghost !py-1 !text-xs" onClick={() => selectPart(p)}>{BODY_PART_LABELS[p]}</button>)}
                    </div>
                  </div>
                ))}

                {workflow === 'symptoms' && (
                  <div className="space-y-4">
                    <SymptomBox onSubmit={runSymptoms} busy={busy === 'symptoms'} disabled={!llmReady} />
                    <SymptomPanel result={symptoms} busy={busy === 'symptoms'} input={symptomInput} />
                  </div>
                )}

                {workflow === 'knowledge' && (
                  <div className="space-y-4">
                    <KnowledgeBox onAsk={runAsk} busy={busy === 'ask'} disabled={!llmReady} />
                    {busy === 'ask' && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={15} className="animate-spin" />Searching PubMed and patient records…</p>}
                    {knowledge && (
                      <div className="space-y-3">
                        <div className="text-xs uppercase tracking-wide text-slate-400">Question</div>
                        <div className="font-medium">{knowledge.q}</div>
                        <div className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm leading-relaxed">{knowledge.answer}</div>
                        {knowledge.warnings.map((w, i) => <div key={i} className="text-xs text-amber-700">⚠ {w}</div>)}
                        <div className="text-xs font-semibold uppercase text-slate-400">Evidence</div>
                        <EvidenceList evidence={knowledge.evidence} />
                        <p className="text-[11px] text-slate-400">Educational information grounded in retrieved literature. Not a patient-specific prediction or treatment plan.</p>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </section>

        <div className="min-h-[480px] lg:min-h-0">
          <VoiceAssistant mic={voice.mic} speaking={voice.speaking} error={voice.error} analyser={voice.analyserRef} messages={messages} thinking={thinking}
            llmReady={llmReady} onToggleMic={toggleMic} onStopSpeaking={voice.stopSpeaking} onSend={t => { greeted.current = true; void handleCommand(t) }} />
        </div>
      </main>

      {camera && <CameraCapture ref={cameraRef} onCapture={onCapture} onClose={() => setCamera(false)} />}
      {confirm && <ConfirmDialog title={confirm.title} message={confirm.message} onCancel={() => setConfirm(null)} onConfirm={() => { const c = confirm; setConfirm(null); c.run() }} />}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ opacity: 0 }}
            className={`fixed bottom-4 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm text-white shadow-lg ${toast.kind === 'error' ? 'bg-rose-600' : 'bg-slate-800'}`}>{toast.text}</motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function SymptomBox({ onSubmit, busy, disabled }: { onSubmit: (t: string) => void; busy: boolean; disabled: boolean }) {
  const [q, setQ] = useState('')
  return (
    <form className="card flex items-center gap-2 border-brand-200 p-3" onSubmit={e => { e.preventDefault(); if (q.trim()) onSubmit(q.trim()) }}>
      <Stethoscope size={18} className="shrink-0 text-brand-600" />
      <input className="input" placeholder="Describe symptoms, e.g. 45M, chest tightness on exertion for 2 weeks, sweating" value={q} onChange={e => setQ(e.target.value)} disabled={disabled} />
      <button className="btn-primary whitespace-nowrap" disabled={busy || disabled || !q.trim()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Activity size={15} />}Analyze</button>
    </form>
  )
}

function KnowledgeBox({ onAsk, busy, disabled }: { onAsk: (q: string) => void; busy: boolean; disabled: boolean }) {
  const [q, setQ] = useState('')
  return (
    <form className="card flex items-center gap-2 p-3" onSubmit={e => { e.preventDefault(); if (q.trim()) onAsk(q.trim()) }}>
      <BookOpen size={18} className="shrink-0 text-brand-600" />
      <input className="input" placeholder="Ask a medical question — answered with PubMed evidence (RAG)…" value={q} onChange={e => setQ(e.target.value)} disabled={disabled} />
      <button className="btn-primary" disabled={busy || disabled || !q.trim()}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}Ask</button>
    </form>
  )
}

function DocList({ docs, onOpen }: { docs: Doc[]; onOpen: (d: Doc) => void }) {
  return (
    <div className="card p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Patient records</div>
      <div className="divide-y divide-slate-100">
        {docs.map(d => (
          <button key={d.id} onClick={() => onOpen(d)} className="flex w-full items-center gap-3 py-2 text-left text-sm hover:bg-slate-50">
            <FileText size={15} className="text-slate-400" />
            <span className="flex-1 truncate">{d.filename}</span>
            <span className="chip bg-slate-100 text-slate-500">{d.category}</span>
            {d.review_status && <span className={`chip ${d.review_status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>{d.review_status}</span>}
            <span className="text-xs text-slate-400">{new Date(d.created_at).toLocaleDateString()}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function MiniSource({ doc, highlight }: { doc: Doc; highlight: { page: number; bbox: BBox } | null }) {
  const page = highlight?.page || 1
  const [url, setUrl] = useState<string | null>(null)
  const visual = doc.content_type === 'application/pdf' || doc.content_type.startsWith('image/')
  useEffect(() => {
    if (!visual) return
    let u: string | null = null
    api.pageImage(doc.id, page).then(b => { u = URL.createObjectURL(b); setUrl(u) }).catch(() => setUrl(null))
    return () => { if (u) URL.revokeObjectURL(u) }
  }, [doc.id, page, visual])
  if (!visual) return null
  const box = highlight?.bbox
  return (
    <div className="sticky top-0 rounded-xl border border-slate-200 p-2">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Source · page {page} <span className="font-normal normal-case">(hover a row)</span></div>
      {url && <div className="relative"><img src={url} className="w-full rounded" alt="source page" />
        {box && <div className="absolute rounded border-2 border-amber-500 bg-amber-300/30" style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${(box[2] - box[0]) * 100}%`, height: `${(box[3] - box[1]) * 100}%` }} />}
      </div>}
    </div>
  )
}
