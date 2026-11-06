import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft, BookOpen, Camera, ChevronRight, FileSearch, FileText, FolderOpen, HeartPulse, Home, LayoutGrid, Loader2,
  LogOut, Mic, RotateCcw, Send, Stethoscope, UploadCloud, X, type LucideIcon,
} from 'lucide-react'
import { api, auth, saveBlob, uploadDocument, ApiError, type FoundFile } from './services/api'
import type { Analysis, DiseaseInfo, Doc, Evidence, Health, SymptomResult, VoiceAction } from './types'
import { useVoice } from './hooks/useVoice'
import VoiceOrb, { orbMode } from './components/VoiceOrb'
import ReportResult from './components/ReportResult'
import SymptomPanel from './components/SymptomPanel'
import BodyHero from './components/BodyHero'
import { DiseaseIntake, DiseaseView } from './components/DiseasePanel'
import { BODY_PART_LABELS } from './components/AnatomyViewer'
import { EvidenceList } from './components/AnalysisPanel'
import { CameraCapture, ConfirmDialog, Login, type CameraHandle } from './components/Overlays'

type Step = 'home' | 'menu' | 'report' | 'upload' | 'disease'

type Result =
  | { kind: 'report'; doc: Doc; analysis: Analysis | null; stage: 'extracting' | 'analyzing' | 'interpreting' | 'done' }
  | { kind: 'symptoms'; input: string; data: SymptomResult | null }
  | { kind: 'disease'; input: string; data: DiseaseInfo | null }
  | { kind: 'answer'; q: string; answer: string | null; evidence: Evidence[] }
  | { kind: 'files'; folder: string; files: FoundFile[] }
  | null

interface Msg { role: 'user' | 'assistant'; content: string }

const YES = /^(yes|yeah|yep|sure|ok|okay|confirm|go ahead|do it|please do)\b/i
const NO = /^(no|nope|cancel|don'?t|never ?mind|stop)\b/i
const ORDINALS: Record<string, number> = { first: 1, one: 1, '1': 1, second: 2, two: 2, '2': 2, third: 3, three: 3, '3': 3,
  fourth: 4, four: 4, '4': 4, fifth: 5, five: 5, '5': 5, sixth: 6, six: 6, '6': 6 }
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.docx,.txt'

const PROMPT: Record<Step, string> = {
  home: '',
  menu: 'How can I help you? Say "one" to analyze a medical report, or "two" to ask about a disease or get recommendations.',
  report: 'Would you like to upload a file, or show the report to the camera?',
  upload: 'Drop the file here or click to browse. You can also tell me where it is, like "the CBC report in Downloads".',
  disease: 'Tell me your symptoms, or name a disease you want to know about.',
}
const PARENT: Record<Step, Step> = { home: 'home', menu: 'home', report: 'menu', upload: 'report', disease: 'menu' }
const TRAIL: Record<Step, string[]> = {
  home: [], menu: ['How can I help'], report: ['How can I help', 'Analyze report'],
  upload: ['How can I help', 'Analyze report', 'Upload file'], disease: ['How can I help', 'Disease & advice'],
}
const TRY: Record<Step, string[]> = {
  home: ['I need help'],
  menu: ['Analyze my medical report', 'Ask about a disease'],
  report: ['Upload a file', 'Use the camera'],
  upload: ['Open the CBC report from Downloads', 'Analyze the latest report on my desktop', 'Read the results'],
  disease: ['I have fever and headache for 3 days', 'Tell me about diabetes', 'How do I prevent dengue?'],
}

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning!' : h < 17 ? 'Good afternoon!' : 'Good evening!'
}

function ChoiceCard({ n, Icon, title, desc, say, gradient, onClick, delay = 0 }: {
  n: number; Icon: LucideIcon; title: string; desc: string; say: string; gradient: string; onClick: () => void; delay?: number
}) {
  return (
    <motion.button initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, type: 'spring', stiffness: 120, damping: 16 }}
      whileHover={{ y: -6, scale: 1.015 }} whileTap={{ scale: 0.98 }} onClick={onClick}
      className="group relative w-full overflow-hidden rounded-3xl border border-white/70 bg-white/85 p-6 text-left shadow-lg backdrop-blur transition-shadow hover:shadow-2xl">
      <div className={`absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-40 ${gradient}`} />
      <div className="flex items-start gap-4">
        <motion.div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-md ${gradient}`}
          animate={{ rotate: [0, -4, 4, 0] }} transition={{ duration: 4, repeat: Infinity, delay }}>
          <Icon size={28} />
        </motion.div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Option {n}</div>
          <div className="mt-0.5 text-lg font-bold text-slate-900">{title}</div>
          <p className="mt-1 text-sm text-slate-500">{desc}</p>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500"><Mic size={12} />Say “{say}”</div>
        </div>
        <ChevronRight className="mt-6 shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-slate-500" />
      </div>
    </motion.button>
  )
}

const Panel = ({ children, k }: { children: React.ReactNode; k: string }) => (
  <motion.div key={k} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}
    className="rounded-3xl border border-white/60 bg-white/85 p-5 shadow-lg backdrop-blur">
    {children}
  </motion.div>
)

export default function SimpleApp({ onAdvanced }: { onAdvanced: () => void }) {
  const [doctor, setDoctor] = useState<string | null>(auth.token ? 'doctor' : null)
  const [health, setHealth] = useState<Health | null>(null)
  const [step, setStep] = useState<Step>('home')
  const [area, setArea] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [heard, setHeard] = useState<string | null>(null)
  const [caption, setCaption] = useState<string | null>(null)
  const [thinking, setThinking] = useState(false)
  const [result, setResult] = useState<Result>(null)
  const [upload, setUpload] = useState<{ name: string; pct: number; cancel: () => void } | null>(null)
  const [busyNote, setBusyNote] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => void } | null>(null)
  const [camera, setCamera] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [drag, setDrag] = useState(false)
  const [text, setText] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<CameraHandle>(null)

  const R = useRef({ result, confirm, upload, messages, step, camera, area })
  R.current = { result, confirm, upload, messages, step, camera, area }

  const voice = useVoice({ onUtterance: (t, u) => onUtterance(t, u) })
  const say = useCallback((t: string, speak = true) => {
    if (!t) return
    setCaption(t)
    setMessages(m => [...m, { role: 'assistant', content: t }])
    if (speak) void voice.speak(t)
  }, [voice])

  useEffect(() => { auth.onUnauthorized(() => { setDoctor(null); voice.stop() }) }, [voice])
  useEffect(() => {
    const ping = () => api.health().then(setHealth).catch(() => setHealth(null))
    ping()
    const t = setInterval(ping, 20000)
    return () => clearInterval(t)
  }, [])

  const llm = !!health?.llm_configured
  // Auto-start only if the user hasn't paused the assistant.
  const micOn = () => { if (llm && (voice.mic === 'off' || voice.mic === 'error')) void voice.startIfAllowed() }

  // ---------------- guided navigation ----------------
  const goStep = (s: Step, speak = true, prefix = '') => {
    setStep(s)
    if (s === 'home' || s === 'menu' || s === 'report') setResult(null)
    if (s === 'home') setArea(null)
    if (speak && PROMPT[s]) say(`${prefix}${PROMPT[s]}`)
  }
  const back = () => { setCamera(false); goStep(PARENT[R.current.step], false) }

  const begin = (part: string | null) => {
    setArea(part)
    micOn()
    goStep('menu', true, part ? `You picked the ${BODY_PART_LABELS[part].toLowerCase()}. ` : `${greeting()} `)
  }

  const openCamera = (speak = true) => {
    setStep('report')
    setCamera(true)
    if (speak) say('Hold the report flat in front of the camera, then say "capture" or tap Capture.')
  }

  // ---------------- report pipeline ----------------
  const setReport = (patch: Partial<Extract<Result, { kind: 'report' }>>) =>
    setResult(r => (r && r.kind === 'report' ? { ...r, ...patch } : r))

  const processDoc = async (d: Doc) => {
    setStep('upload')
    setResult({ kind: 'report', doc: d, analysis: null, stage: 'analyzing' })
    if (d.status === 'failed' || !d.extraction?.pages?.length) {
      setReport({ stage: 'done' })
      say(d.extraction?.error || "I couldn't read any text from that file. If it's a photo, make sure it's sharp and well lit and try again.")
      return
    }
    const ocr = d.extraction.pages.some(p => p.method.startsWith('ocr'))
    say(`Got it, reading ${d.filename}${ocr ? '. It is a scanned image, so this takes a few seconds' : ''}.`)
    try {
      const a = await api.analyze(d.id)
      setReport({ analysis: a, stage: 'interpreting' })
      try {
        const r = await api.interpret(a.id)
        setReport({ analysis: r, stage: 'done' })
        const it = r.interpretation
        const tip = it?.precautions?.[0] ? ` One precaution to start with: ${it.precautions[0]}` : ''
        say(`${it?.spoken_summary || it?.summary || 'The analysis is ready.'}${tip} Say "read the results" to hear the full advice.`)
      } catch (e) {
        setReport({ stage: 'done' })
        const abn = a.structured.rows.filter(x => ['high', 'low'].includes(x.evaluation.status))
        say(`I extracted ${a.structured.rows.length} values${abn.length ? `; ${abn.map(x => `${x.test_name} is ${x.evaluation.status}`).join(', ')}` : ''}. I couldn't add the AI explanation: ${(e as Error).message}`)
      }
    } catch (e) {
      setReport({ stage: 'done' })
      say(`I couldn't analyze it: ${(e as Error).message}`)
    }
  }

  const uploadFile = async (file: File | Blob, name: string) => {
    setStep('upload')
    const u = uploadDocument(file, name, 'report', null, pct => setUpload(x => x && { ...x, pct }))
    setUpload({ name, pct: 0, cancel: u.cancel })
    try { await processDoc(await u.promise) }
    catch (e) { if (!(e instanceof ApiError && e.status === -1)) say(`Upload failed: ${(e as Error).message}`) }
    finally { setUpload(null) }
  }

  const onCapture = (b: Blob) => {
    setCamera(false)
    say('Captured. Let me read it.', false)
    void uploadFile(b, `camera_report_${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`)
  }

  const openToken = async (f: FoundFile) => {
    setBusyNote(`Opening ${f.name}…`)
    try { await processDoc(await api.openFound(f.token)) }
    catch (e) { say(`I couldn't open that file: ${(e as Error).message}`) }
    finally { setBusyNote(null) }
  }

  const findAndOpen = async (location?: string, query?: string) => {
    setStep('upload')
    const q = (query || '').trim()
    setBusyNote(`Looking${q && !/^latest|newest|recent$/i.test(q) ? ` for “${q}”` : ' for the latest report'}${location ? ` in ${location}` : ''}…`)
    try {
      const r = await api.findFiles(location || undefined, q)
      setBusyNote(null)
      if (r.error) { say(`${r.error} Try Downloads, Desktop or Documents, or say "upload file" to browse.`); return }
      if (!r.candidates.length) { say(`I couldn't find a report matching “${q || 'that'}” in ${r.folder}. Say "upload file" to browse instead.`); return }
      if (r.confident) { say(`Found ${r.candidates[0].name}.`, false); await openToken(r.candidates[0]); return }
      setResult({ kind: 'files', folder: r.folder, files: r.candidates })
      say(`I found ${r.candidates.length} files in ${r.folder}. ${r.candidates.slice(0, 3).map((c, i) => `Number ${i + 1}: ${c.name.replace(/\.[^.]+$/, '')}`).join('. ')}. Which one should I open?`)
    } catch (e) {
      setBusyNote(null)
      say(`I couldn't search your files: ${(e as Error).message}`)
    }
  }

  const openPicker = async (location?: string) => {
    setStep('upload')
    const clicked = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive
    if (clicked && fileInput.current) { fileInput.current.click(); return }
    if (!health?.local_file_dialog) { say('Click the upload box to choose the file.'); return }
    setBusyNote('A file browser is open on your computer. Choose the report (check the taskbar if you don’t see it).')
    try {
      const d = await api.pickLocal('report', null, location)
      setBusyNote(null)
      if (d.cancelled) { say('No file chosen. Tell me whenever you’re ready.'); return }
      await processDoc(d)
    } catch (e) {
      setBusyNote(null)
      say(e instanceof ApiError && (e.status === 403 || e.status === 501) ? 'I can’t open the file browser from here. Please use the upload box.' : `Upload failed: ${(e as Error).message}`)
    }
  }

  // ---------------- disease / symptoms ----------------
  const runSymptoms = async (t: string) => {
    setStep('disease')
    setResult({ kind: 'symptoms', input: t, data: null })
    try {
      const r = await api.symptoms(t)
      setResult({ kind: 'symptoms', input: t, data: r })
      say(r.spoken_summary || 'Here is what I think.')
    } catch (e) { setResult(null); say(`Sorry, I couldn't analyze that: ${(e as Error).message}`) }
  }

  const runDisease = async (name: string) => {
    setStep('disease')
    setResult({ kind: 'disease', input: name, data: null })
    try {
      const r = await api.disease(name)
      setResult({ kind: 'disease', input: name, data: r })
      say(r.spoken_summary || r.overview)
    } catch (e) { setResult(null); say(`Sorry, I couldn't look that up: ${(e as Error).message}`) }
  }

  const runAsk = async (q: string) => {
    setStep('disease')
    setResult({ kind: 'answer', q, answer: null, evidence: [] })
    try { const r = await api.ask(q); setResult({ kind: 'answer', q, answer: r.answer, evidence: r.evidence }); say(r.answer) }
    catch (e) { setResult(null); say(`Sorry: ${(e as Error).message}`) }
  }

  const currentAnalysis = () => { const r = R.current.result; return r?.kind === 'report' ? r.analysis : null }

  const readAloud = () => {
    const r = R.current.result
    const list = (label: string, xs?: string[]) => (xs?.length ? ` ${label}: ${xs.slice(0, 3).join('. ')}.` : '')
    if (r?.kind === 'report' && r.analysis) {
      const it = r.analysis.interpretation
      const abn = r.analysis.structured.rows.filter(x => ['high', 'low'].includes(x.evaluation.status))
      say((it?.spoken_summary || `${r.analysis.structured.report_type}. ${abn.length ? abn.map(x => `${x.test_name} ${x.result} ${x.unit || ''}, ${x.evaluation.status}`).join('; ') : 'All values are within range.'}`)
        + list('Precautions', it?.precautions) + list('Things to avoid', it?.avoid) + list('See a doctor quickly if', it?.see_doctor_if))
    } else if (r?.kind === 'symptoms' && r.data) {
      say((r.data.spoken_summary || '') + list('Precautions', r.data.precautions) + list('Avoid', r.data.avoid) + list('Prevention', r.data.prevention))
    } else if (r?.kind === 'disease' && r.data) {
      say((r.data.spoken_summary || r.data.overview) + list('Prevention', r.data.prevention) + list('Avoid', r.data.avoid))
    } else say("There's nothing to read yet. Upload a report or tell me your symptoms.")
  }

  const approveAndDownload = async () => {
    const a = currentAnalysis()
    if (!a) { say('There is no analysed report yet.'); return }
    setDownloading(true)
    try {
      if (a.review_status !== 'approved') await api.updateAnalysis(a.id, { review_status: 'approved' })
      const rep = await api.generateReport(a.id)
      saveBlob(await api.downloadReport(rep.id), `medlens_report_${a.id}.pdf`)
      setReport({ analysis: await api.analysis(a.id) })
      say('Done. The PDF report has been downloaded.')
    } catch (e) { say(`I couldn't create the PDF: ${(e as Error).message}`) } finally { setDownloading(false) }
  }

  const askDownload = () => setConfirm({ title: 'Approve & download report', message: 'Do you approve this AI analysis and want to download it as a PDF?', run: approveAndDownload })

  const askFollowUp = (q: string) => { micOn(); say(q) }

  // ---------------- voice ----------------
  const dispatch = (a: VoiceAction) => {
    const args = a.args
    switch (a.name) {
      case 'navigate_to': {
        const s = args.step
        if (s === 'camera') openCamera(false)
        else if (s === 'home' || s === 'menu' || s === 'report' || s === 'upload' || s === 'disease') goStep(s, false)
        return
      }
      case 'ask_about_disease': void runDisease(args.disease); return
      case 'open_file_from_computer': void findAndOpen(args.location, args.file_query); return
      case 'open_report_upload': void openPicker(args.location); return
      case 'activate_camera': openCamera(false); return
      case 'capture_image': if (cameraRef.current) cameraRef.current.capture(); else say('The camera is not open. Say "use the camera" first.'); return
      case 'select_body_part': setArea(args.body_part); if (R.current.step === 'home') setStep('menu'); return
      case 'analyze_symptoms': void runSymptoms(args.symptoms); return
      case 'analyze_medical_document': {
        const r = R.current.result
        if (r?.kind === 'report') void processDoc(r.doc)
        else { goStep('report', false); say('Sure. Upload the file, show it to the camera, or tell me where it is.') }
        return
      }
      case 'explain_medical_findings': {
        const an = currentAnalysis()
        if (an) {
          setReport({ stage: 'interpreting' })
          api.interpret(an.id, args.question).then(r => { setReport({ analysis: r, stage: 'done' }); say(r.interpretation?.spoken_summary || r.interpretation?.summary || '') })
            .catch(e => { setReport({ stage: 'done' }); say((e as Error).message) })
        } else void runAsk(args.question || 'Explain these findings')
        return
      }
      case 'retrieve_medical_evidence': void runAsk(args.query); return
      case 'read_results_aloud': readAloud(); return
      case 'generate_medical_report': case 'download_medical_report': askDownload(); return
      case 'show_original_document': say('Tap “Show original” on the report card to see the original document.', false); return
      case 'stop_speaking': voice.stopSpeaking(); return
      case 'repeat_last_answer': voice.repeat(); return
      case 'cancel_current_operation': R.current.upload?.cancel(); setBusyNote(null); setCamera(false); say('Cancelled.', false); return
      case 'go_back': back(); return
      default: say('That one lives in the advanced workspace. Tap “Advanced” at the top right.')
    }
  }

  const handleCommand = async (t: string) => {
    setHeard(t)
    setMessages(m => [...m, { role: 'user', content: t }])
    if (/^(stop( speaking)?|be quiet|silence)\.?$/i.test(t)) { voice.stopSpeaking(); return }
    setThinking(true)
    try {
      const r = R.current.result
      const ctx = {
        view: 'guided', step: R.current.step, camera_open: R.current.camera, body_area: R.current.area,
        document: r?.kind === 'report' ? r.doc.filename : null, has_analysis: !!currentAnalysis(),
        showing: r?.kind || 'nothing', file_choices: r?.kind === 'files' ? r.files.map(f => f.name) : undefined,
      }
      const res = await api.command(t, R.current.messages.slice(-10), ctx)
      const silent = res.actions.some(x => ['stop_speaking', 'repeat_last_answer', 'read_results_aloud', 'explain_medical_findings', 'retrieve_medical_evidence'].includes(x.name))
      if (res.reply) say(res.reply, !silent)
      res.actions.forEach(dispatch)
    } catch (e) { say(`Sorry, ${(e as Error).message}`) } finally { setThinking(false) }
  }

  /** Quick local handling of short navigation phrases, so stepping through the flow by voice is instant. */
  const quickNav = (clean: string): boolean => {
    const s = clean.toLowerCase()
    if (s.split(/\s+/).length > 6) return false
    const st = R.current.step
    if (R.current.camera && /\b(capture|take|click|snap|shoot|scan it)\b/.test(s)) { cameraRef.current?.capture(); return true }
    if (/^(go )?back$|^previous$/.test(s)) { back(); return true }
    if (/\b(home|start over|main menu)\b/.test(s)) { goStep('home', false); say('Back to the start. Tap the body or say "I need help".', true); return true }
    if (/^(read|read (it|the results|aloud)|read results)$/.test(s)) { readAloud(); return true }
    if (st === 'home' && /\b(help|hello|hi|hey|start|begin)\b/.test(s)) { goStep('menu', true, `${greeting()} `); return true }
    if (st === 'menu') {
      if (/\b(one|1|first|report|analy[sz]e)\b/.test(s)) { goStep('report'); return true }
      if (/\b(two|2|second|disease|symptoms?|ask|recommend\w*|advice)\b/.test(s)) { goStep('disease'); return true }
    }
    if (st === 'report') {
      if (/\b(camera|scan|photo|two|2|second|show)\b/.test(s)) { openCamera(); return true }
      if (/\b(upload|file|browse|one|1|first)\b/.test(s)) { goStep('upload'); return true }
    }
    return false
  }

  function onUtterance(t: string, uncertain: boolean) {
    const clean = t.trim().replace(/[.!?]+$/, '')
    const c = R.current.confirm
    if (c) {
      setHeard(t)
      if (YES.test(clean)) { setConfirm(null); c.run() } else if (NO.test(clean)) { setConfirm(null); say('Okay.') } else say('Please say yes or no.')
      return
    }
    const r = R.current.result
    if (r?.kind === 'files') {
      const words = clean.toLowerCase().split(/\s+/)
      const n = words.map(w => ORDINALS[w]).find(Boolean) || (/\blast\b/.test(clean.toLowerCase()) ? r.files.length : 0)
      const byName = r.files.find(f => words.filter(w => w.length > 2).some(w => f.name.toLowerCase().includes(w)))
      const pick = n && n <= r.files.length ? r.files[n - 1] : !/\b(open|find|search|from|in)\b/i.test(clean) ? byName : undefined
      if (pick) { setHeard(t); say(`Opening ${pick.name}.`, false); void openToken(pick); return }
      if (NO.test(clean)) { setResult(null); say('Okay, never mind.'); return }
    }
    if (uncertain) { setHeard(t); say(`Sorry, I didn't quite catch that. Did you say “${t}”? Please say it again.`); return }
    if (quickNav(clean)) { setHeard(t); setMessages(m => [...m, { role: 'user', content: t }]); return }
    void handleCommand(t)
  }

  const onOrb = () => {
    if (voice.speaking) { voice.stopSpeaking(); return }
    if (voice.paused || voice.mic === 'off' || voice.mic === 'error') {
      void voice.resume()
      if (R.current.step === 'home') goStep('menu', true, `${greeting()} `)
      else say(PROMPT[R.current.step] || "I'm listening again. How can I help?")
    } else {
      voice.pause()
      setCaption('Paused. I won’t listen or speak until you tap the mic again.')
    }
  }

  if (!doctor) return <Login onLogin={setDoctor} />
  const mode = orbMode(voice.mic, voice.speaking, thinking, voice.paused)
  const resultBusy = !!result && 'data' in result && !result.data

  return (
    <div className="relative min-h-full overflow-x-hidden bg-gradient-to-br from-slate-50 via-white to-brand-50">
      <motion.div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand-200/40 blur-3xl" animate={{ x: [0, 40, 0], y: [0, 30, 0] }} transition={{ duration: 14, repeat: Infinity }} />
      <motion.div className="pointer-events-none absolute -right-32 top-40 h-96 w-96 rounded-full bg-violet-200/30 blur-3xl" animate={{ x: [0, -30, 0], y: [0, 40, 0] }} transition={{ duration: 16, repeat: Infinity }} />

      <input ref={fileInput} type="file" accept={ACCEPT} hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadFile(f, f.name) }} />

      <header className="relative z-10 mx-auto flex max-w-7xl items-center gap-3 px-5 py-4">
        <button onClick={() => goStep('home', false)} className="flex items-center gap-3 text-left" title="Home">
          <motion.div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-600 text-white shadow" animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 2, repeat: Infinity }}>
            <HeartPulse size={20} />
          </motion.div>
          <div className="leading-tight">
            <div className="whitespace-nowrap text-lg font-bold text-slate-900">MedLens AI</div>
            <div className="hidden text-xs text-slate-500 sm:block">Your voice health assistant</div>
          </div>
        </button>
        <span className="mr-auto" />
        <span className={`chip ${llm ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${llm ? 'animate-pulse bg-emerald-500' : 'bg-rose-500'}`} /><span className="hidden sm:inline">{llm ? 'AI ready' : health ? 'AI key missing' : 'Server offline'}</span>
        </span>
        <button className="btn-ghost !py-1.5 !text-xs" onClick={onAdvanced} title="Full workspace"><LayoutGrid size={14} /><span className="hidden sm:inline">Advanced</span></button>
        <button className="btn-ghost !px-2 !py-1.5" title="Sign out" onClick={() => { auth.set(null); voice.stop(); setDoctor(null) }}><LogOut size={14} /></button>
      </header>

      <main className="relative z-10 mx-auto grid max-w-7xl gap-6 px-5 pb-10 lg:grid-cols-[360px_1fr]">
        {/* ---------- voice column ---------- */}
        <section className="order-2 lg:order-none lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-3xl border border-white/60 bg-white/75 p-6 shadow-xl backdrop-blur">
            <VoiceOrb mode={mode} analyser={voice.analyserRef} disabled={!llm} onClick={onOrb} />
            <div className="mt-4 min-h-[96px] text-center">
              <AnimatePresence mode="wait">
                {heard && <motion.p key={'h' + heard} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-2 text-sm italic text-slate-400">“{heard}”</motion.p>}
              </AnimatePresence>
              <AnimatePresence mode="wait">
                <motion.p key={caption || 'empty'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="text-[15px] leading-relaxed text-slate-700">
                  {caption || (llm ? 'Tap the mic and just talk. I can guide you through every step by voice.' : 'Add GROQ_API_KEY to backend/.env to enable the assistant.')}
                </motion.p>
              </AnimatePresence>
              {voice.error && <p className="mt-2 text-xs text-rose-600">{voice.error}</p>}
            </div>
            {llm && (
              <div className="mt-3">
                <div className="mb-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">Try saying</div>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {TRY[step].map(t => <button key={t} onClick={() => onUtterance(t, false)} className="rounded-full bg-brand-50 px-3 py-1 text-xs text-brand-700 transition hover:bg-brand-100">“{t}”</button>)}
                </div>
              </div>
            )}
            <form className="mt-4 flex gap-2" onSubmit={e => { e.preventDefault(); if (text.trim()) { onUtterance(text.trim(), false); setText('') } }}>
              <input className="input !rounded-full !px-4" placeholder="…or type here" value={text} onChange={e => setText(e.target.value)} disabled={!llm} />
              <button className="btn-primary !rounded-full !px-3" disabled={!llm || !text.trim()} aria-label="Send"><Send size={16} /></button>
            </form>
          </div>
        </section>

        {/* ---------- guided stage ---------- */}
        <section className="order-1 min-w-0 space-y-5 lg:order-none">
          {step !== 'home' && (
            <motion.nav initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-wrap items-center gap-2 text-sm">
              <button className="btn-ghost !rounded-full !py-1.5" onClick={back}><ArrowLeft size={14} />Back</button>
              <button className="flex items-center gap-1 text-slate-400 hover:text-slate-700" onClick={() => goStep('home', false)}><Home size={14} /></button>
              {TRAIL[step].map((t, i) => (
                <span key={t} className="flex items-center gap-2 text-slate-400"><ChevronRight size={14} />
                  <span className={i === TRAIL[step].length - 1 ? 'font-semibold text-slate-700' : ''}>{t}</span></span>
              ))}
              {area && <span className="chip ml-auto bg-brand-100 text-brand-800">Area: {BODY_PART_LABELS[area]}
                <button onClick={() => setArea(null)} aria-label="Clear area"><X size={12} /></button></span>}
            </motion.nav>
          )}

          <AnimatePresence>
            {busyNote && (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex items-center gap-2 rounded-2xl bg-brand-50 px-4 py-3 text-sm text-brand-800"><FolderOpen size={16} />{busyNote}<Loader2 size={14} className="ml-auto animate-spin" /></motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {step === 'home' && (
              <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.97 }}
                className="flex flex-col items-center rounded-3xl border border-white/60 bg-white/50 py-6 backdrop-blur" onClick={() => begin(null)}>
                <motion.h1 initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-center text-2xl font-bold text-slate-900 sm:text-3xl">
                  Hi, I'm <span className="bg-gradient-to-r from-brand-600 to-violet-600 bg-clip-text text-transparent">MedLens</span>
                </motion.h1>
                <p className="mb-4 mt-1 text-center text-sm text-slate-500">Tap any part of the body to start, or just talk to me.</p>
                <BodyHero selected={area} onSelect={begin} />
              </motion.div>
            )}

            {step === 'menu' && (
              <motion.div key="menu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid items-center gap-6 md:grid-cols-[220px_1fr]">
                <div className="hidden md:block"><BodyHero selected={area} onSelect={p => p && setArea(p)} compact /></div>
                <div className="space-y-4">
                  <motion.h2 initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-bold text-slate-900">How can I help you?</motion.h2>
                  <ChoiceCard n={1} Icon={FileSearch} title="Analyze a medical report" gradient="bg-gradient-to-br from-brand-500 to-brand-700"
                    desc="Upload a file or show it to the camera. I'll explain it simply, with precautions and what to avoid." say="analyze my report" onClick={() => goStep('report')} delay={0.05} />
                  <ChoiceCard n={2} Icon={Stethoscope} title="Ask about a disease or get advice" gradient="bg-gradient-to-br from-violet-500 to-fuchsia-600"
                    desc="Tell me your symptoms for possible conditions, or learn causes, prevention and precautions for any disease." say="ask about a disease" onClick={() => goStep('disease')} delay={0.15} />
                </div>
              </motion.div>
            )}

            {step === 'report' && (
              <motion.div key="report" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                <motion.h2 initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-bold text-slate-900">How would you like to share the report?</motion.h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <ChoiceCard n={1} Icon={UploadCloud} title="Upload a file" gradient="bg-gradient-to-br from-sky-500 to-brand-600"
                    desc="PDF, photo, Word or text. Browse yourself, or tell me where it is." say="upload a file" onClick={() => goStep('upload')} delay={0.05} />
                  <ChoiceCard n={2} Icon={Camera} title="Show it on camera" gradient="bg-gradient-to-br from-amber-500 to-rose-500"
                    desc="Hold the paper report in front of your webcam or phone camera." say="use the camera" onClick={() => openCamera()} delay={0.15} />
                </div>
              </motion.div>
            )}

            {step === 'upload' && (
              <motion.div key="upload" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                {(!result || (result.kind !== 'report' && result.kind !== 'files')) && (
                  <>
                    <motion.div
                      onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
                      onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void uploadFile(f, f.name) }}
                      onClick={() => !upload && fileInput.current?.click()}
                      animate={{ scale: drag ? 1.02 : 1 }}
                      className={`cursor-pointer rounded-3xl border-2 border-dashed p-10 text-center transition ${drag ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-white/80 hover:border-brand-400 hover:bg-white'}`}>
                      {upload ? (
                        <div className="mx-auto max-w-sm">
                          <div className="mb-2 flex items-center justify-between text-sm"><span className="truncate font-medium">{upload.name}</span>
                            <button className="btn-ghost !p-1" onClick={e => { e.stopPropagation(); upload.cancel() }}><X size={14} /></button></div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-200"><motion.div className="h-full bg-brand-500" animate={{ width: `${upload.pct}%` }} /></div>
                          <p className="mt-2 text-xs text-slate-500">{upload.pct < 100 ? `Uploading ${upload.pct}%` : 'Reading document…'}</p>
                        </div>
                      ) : (
                        <>
                          <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 2.4, repeat: Infinity }} className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-100 text-brand-600"><UploadCloud size={34} /></motion.div>
                          <div className="text-lg font-semibold text-slate-800">Drop your medical report here</div>
                          <div className="mt-1 text-sm text-slate-500">or click to browse · PDF, image, Word or text</div>
                        </>
                      )}
                    </motion.div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex items-center gap-3 rounded-2xl bg-white/80 p-4 text-sm text-slate-600 shadow-sm">
                        <Mic className="shrink-0 text-brand-600" size={20} /><span>Or say <b>“open the CBC report from Downloads”</b> and I'll find it for you.</span>
                      </div>
                      <button onClick={() => openCamera()} className="flex items-center gap-3 rounded-2xl bg-white/80 p-4 text-left text-sm text-slate-600 shadow-sm transition hover:bg-white">
                        <Camera className="shrink-0 text-amber-600" size={20} /><span>Paper report? <b>Use the camera</b> instead.</span>
                      </button>
                    </div>
                  </>
                )}
                {result?.kind === 'report' && (
                  <Panel k={'r' + result.doc.id}>
                    <ReportResult doc={result.doc} analysis={result.analysis} stage={result.stage} onReadAloud={readAloud} onDownload={askDownload} downloading={downloading} />
                    {result.stage === 'done' && <div className="mt-4 flex justify-center"><button className="btn-ghost" onClick={() => setResult(null)}><RotateCcw size={14} />Analyze another report</button></div>}
                  </Panel>
                )}
                {result?.kind === 'files' && (
                  <Panel k="files">
                    <div className="mb-3 text-sm font-semibold">Which file? <span className="font-normal text-slate-500">Say “number 2” or tap one · {result.folder}</span></div>
                    <div className="space-y-2">
                      {result.files.map((f, i) => (
                        <motion.button key={f.token} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                          onClick={() => void openToken(f)} className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-brand-400 hover:shadow">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">{i + 1}</span>
                          <FileText size={18} className="shrink-0 text-slate-400" />
                          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{f.name}</span>
                            <span className="block truncate text-xs text-slate-400">{f.folder} · {new Date(f.modified * 1000).toLocaleDateString()}</span></span>
                        </motion.button>
                      ))}
                    </div>
                  </Panel>
                )}
              </motion.div>
            )}

            {step === 'disease' && (
              <motion.div key="disease" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                {(!result || result.kind === 'report' || result.kind === 'files') ? (
                  <>
                    <motion.h2 initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-bold text-slate-900">What's bothering you?</motion.h2>
                    <DiseaseIntake area={area} busy={resultBusy} onSymptoms={t => void runSymptoms(t)} onDisease={d => void runDisease(d)} />
                  </>
                ) : (
                  <>
                    {result.kind === 'symptoms' && <Panel k={'s' + result.input}><SymptomPanel result={result.data} busy={!result.data} input={result.input} onQuestion={askFollowUp} /></Panel>}
                    {result.kind === 'disease' && <Panel k={'d' + result.input}><DiseaseView data={result.data} busy={!result.data} name={result.input} /></Panel>}
                    {result.kind === 'answer' && (
                      <Panel k={'a' + result.q}>
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 font-semibold"><BookOpen size={17} className="text-brand-600" />{result.q}</div>
                          {result.answer ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{result.answer}</p>
                            : <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={15} className="animate-spin" />Searching medical literature…</p>}
                          {result.evidence.length > 0 && <details><summary className="cursor-pointer text-xs font-semibold text-slate-500">Sources ({result.evidence.length})</summary><div className="mt-2"><EvidenceList evidence={result.evidence} /></div></details>}
                        </div>
                      </Panel>
                    )}
                    {!resultBusy && <div className="flex justify-center"><button className="btn-ghost" onClick={() => setResult(null)}><RotateCcw size={14} />Ask something else</button></div>}
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>

      {camera && <CameraCapture ref={cameraRef} onCapture={onCapture} onClose={() => setCamera(false)} />}
      {confirm && <ConfirmDialog title={confirm.title} message={confirm.message} onCancel={() => setConfirm(null)} onConfirm={() => { const c = confirm; setConfirm(null); c.run() }} />}
    </div>
  )
}
