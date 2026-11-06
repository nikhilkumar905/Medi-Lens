import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { FileText, FolderOpen, Loader2, LogOut, Send, Sparkles, Stethoscope, UploadCloud, X, LayoutGrid, BookOpen } from 'lucide-react'
import { api, auth, saveBlob, uploadDocument, ApiError, type FoundFile } from './services/api'
import type { Analysis, Doc, Evidence, Health, SymptomResult, VoiceAction } from './types'
import { useVoice } from './hooks/useVoice'
import VoiceOrb, { orbMode } from './components/VoiceOrb'
import ReportResult from './components/ReportResult'
import SymptomPanel from './components/SymptomPanel'
import { EvidenceList } from './components/AnalysisPanel'
import { ConfirmDialog, Login } from './components/Overlays'

type Result =
  | { kind: 'report'; doc: Doc; analysis: Analysis | null; stage: 'extracting' | 'analyzing' | 'interpreting' | 'done' }
  | { kind: 'symptoms'; input: string; data: SymptomResult | null }
  | { kind: 'answer'; q: string; answer: string | null; evidence: Evidence[] }
  | { kind: 'files'; folder: string; files: FoundFile[] }
  | null

interface Msg { role: 'user' | 'assistant'; content: string }

const YES = /^(yes|yeah|yep|sure|ok|okay|confirm|go ahead|do it|please do)\b/i
const NO = /^(no|nope|cancel|don'?t|never ?mind|stop)\b/i
const ORDINALS: Record<string, number> = { first: 1, one: 1, '1': 1, second: 2, two: 2, '2': 2, third: 3, three: 3, '3': 3,
  fourth: 4, four: 4, '4': 4, fifth: 5, five: 5, '5': 5, sixth: 6, six: 6, '6': 6 }
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.docx,.txt'
const TRY = ['Open the CBC report from Downloads', 'Analyze the latest report on my desktop', 'Patient has fever and joint pain for 3 days']

function hello() {
  const h = new Date().getHours()
  return `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, Doctor! How can I help you today?`
}

export default function SimpleApp({ onAdvanced }: { onAdvanced: () => void }) {
  const [doctor, setDoctor] = useState<string | null>(auth.token ? 'doctor' : null)
  const [health, setHealth] = useState<Health | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [heard, setHeard] = useState<string | null>(null)
  const [caption, setCaption] = useState<string | null>(null)
  const [thinking, setThinking] = useState(false)
  const [result, setResult] = useState<Result>(null)
  const [upload, setUpload] = useState<{ name: string; pct: number; cancel: () => void } | null>(null)
  const [busyNote, setBusyNote] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => void } | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [drag, setDrag] = useState(false)
  const [text, setText] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const greetedOnce = useRef(false)

  const R = useRef({ result, confirm, upload, messages })
  R.current = { result, confirm, upload, messages }

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

  // ---------------- report pipeline ----------------
  const setReport = (patch: Partial<Extract<Result, { kind: 'report' }>>) =>
    setResult(r => (r && r.kind === 'report' ? { ...r, ...patch } : r))

  const processDoc = async (d: Doc) => {
    setResult({ kind: 'report', doc: d, analysis: null, stage: 'analyzing' })
    if (d.status === 'failed' || !d.extraction?.pages?.length) {
      setReport({ stage: 'done' })
      say(d.extraction?.error || "I couldn't read any text from that file. If it's a scan, make sure it's clear and try again.")
      return
    }
    const ocr = d.extraction.pages.some(p => p.method.startsWith('ocr'))
    say(`Got it — reading ${d.filename}${ocr ? '. It is a scanned page, so this takes a few seconds' : ''}.`)
    try {
      const a = await api.analyze(d.id)
      setReport({ analysis: a, stage: 'interpreting' })
      try {
        const r = await api.interpret(a.id)
        setReport({ analysis: r, stage: 'done' })
        say(r.interpretation?.spoken_summary || r.interpretation?.summary || 'The analysis is ready.')
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

  const uploadFile = async (file: File) => {
    const u = uploadDocument(file, file.name, 'report', null, pct => setUpload(x => x && { ...x, pct }))
    setUpload({ name: file.name, pct: 0, cancel: u.cancel })
    try { await processDoc(await u.promise) }
    catch (e) { if (!(e instanceof ApiError && e.status === -1)) say(`Upload failed: ${(e as Error).message}`) }
    finally { setUpload(null) }
  }

  const openToken = async (f: FoundFile) => {
    setBusyNote(`Opening ${f.name}…`)
    try { await processDoc(await api.openFound(f.token)) }
    catch (e) { say(`I couldn't open that file: ${(e as Error).message}`) }
    finally { setBusyNote(null) }
  }

  const findAndOpen = async (location?: string, query?: string) => {
    const q = (query || '').trim()
    setBusyNote(`Looking${q && !/^latest|newest|recent$/i.test(q) ? ` for “${q}”` : ' for the latest report'}${location ? ` in ${location}` : ''}…`)
    try {
      const r = await api.findFiles(location || undefined, q)
      setBusyNote(null)
      if (r.error) { say(`${r.error} Try Downloads, Desktop or Documents, or say "upload file" to browse.`); return }
      if (!r.candidates.length) { say(`I couldn't find a report matching “${q || 'that'}” in ${r.folder}. Want me to open the file browser there? Just say upload file.`); return }
      if (r.confident) { say(`Found ${r.candidates[0].name}.`, false); await openToken(r.candidates[0]); return }
      setResult({ kind: 'files', folder: r.folder, files: r.candidates })
      say(`I found ${r.candidates.length} files in ${r.folder}. ${r.candidates.slice(0, 3).map((c, i) => `Number ${i + 1}: ${c.name.replace(/\.[^.]+$/, '')}`).join('. ')}. Which one should I open?`)
    } catch (e) {
      setBusyNote(null)
      say(`I couldn't search your files: ${(e as Error).message}`)
    }
  }

  const openPicker = async (location?: string) => {
    const clicked = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive
    if (clicked && fileInput.current) { fileInput.current.click(); return }
    if (!health?.local_file_dialog) { say('Click the upload box below to choose the file.'); return }
    setBusyNote('A file browser is open on your computer — choose the report (check the taskbar if you don’t see it).')
    try {
      const d = await api.pickLocal('report', null, location)
      setBusyNote(null)
      if (d.cancelled) { say('No file chosen. Tell me whenever you’re ready.'); return }
      await processDoc(d)
    } catch (e) {
      setBusyNote(null)
      say(e instanceof ApiError && (e.status === 403 || e.status === 501) ? 'I can’t open the file browser from here — please use the upload box below.' : `Upload failed: ${(e as Error).message}`)
    }
  }

  // ---------------- other actions ----------------
  const runSymptoms = async (t: string) => {
    setResult({ kind: 'symptoms', input: t, data: null })
    try {
      const r = await api.symptoms(t)
      setResult({ kind: 'symptoms', input: t, data: r })
      say(r.spoken_summary || 'Here is what I think.')
    } catch (e) { setResult(null); say(`Sorry, I couldn't analyze that: ${(e as Error).message}`) }
  }

  const runAsk = async (q: string) => {
    setResult({ kind: 'answer', q, answer: null, evidence: [] })
    try { const r = await api.ask(q); setResult({ kind: 'answer', q, answer: r.answer, evidence: r.evidence }); say(r.answer) }
    catch (e) { setResult(null); say(`Sorry: ${(e as Error).message}`) }
  }

  const currentAnalysis = () => { const r = R.current.result; return r?.kind === 'report' ? r.analysis : null }

  const readAloud = () => {
    const r = R.current.result
    if (r?.kind === 'report' && r.analysis) {
      const it = r.analysis.interpretation
      const abn = r.analysis.structured.rows.filter(x => ['high', 'low'].includes(x.evaluation.status))
      say(it?.spoken_summary || `${r.analysis.structured.report_type}. ${abn.length ? abn.map(x => `${x.test_name} ${x.result} ${x.unit || ''}, ${x.evaluation.status}`).join('; ') : 'All values are within range.'}`)
    } else if (r?.kind === 'symptoms' && r.data?.spoken_summary) say(r.data.spoken_summary)
    else say("There's nothing to read yet. Upload a report or tell me the symptoms.")
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
      say('Done — the PDF report has been downloaded.')
    } catch (e) { say(`I couldn't create the PDF: ${(e as Error).message}`) } finally { setDownloading(false) }
  }

  const askDownload = () => setConfirm({ title: 'Approve & download report', message: 'Do you approve this AI analysis and want to download it as a PDF?', run: approveAndDownload })

  const dispatch = (a: VoiceAction) => {
    const args = a.args
    switch (a.name) {
      case 'open_file_from_computer': void findAndOpen(args.location, args.file_query); return
      case 'open_report_upload': void openPicker(args.location); return
      case 'analyze_symptoms': void runSymptoms(args.symptoms); return
      case 'analyze_medical_document': {
        const r = R.current.result
        if (r?.kind === 'report') void processDoc(r.doc)
        else say("Sure — tell me where the file is, like “the CBC report in Downloads”, or say upload file.")
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
      case 'cancel_current_operation': R.current.upload?.cancel(); setBusyNote(null); say('Cancelled.', false); return
      case 'go_back': setResult(null); return
      default: say('That one lives in the advanced workspace — tap “Advanced” at the top right.')
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
        view: 'simple', document: r?.kind === 'report' ? r.doc.filename : null, has_analysis: !!currentAnalysis(),
        showing: r?.kind || 'nothing', file_choices: r?.kind === 'files' ? r.files.map(f => f.name) : undefined,
      }
      const history = R.current.messages.slice(-10)
      const res = await api.command(t, history, ctx)
      const silent = res.actions.some(x => ['stop_speaking', 'repeat_last_answer', 'read_results_aloud', 'explain_medical_findings', 'retrieve_medical_evidence'].includes(x.name))
      if (res.reply) say(res.reply, !silent)
      res.actions.forEach(dispatch)
    } catch (e) { say(`Sorry — ${(e as Error).message}`) } finally { setThinking(false) }
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
    if (r?.kind === 'files') {   // choosing among found files: "the second one", "number 2", or part of a name
      const words = clean.toLowerCase().split(/\s+/)
      const n = words.map(w => ORDINALS[w]).find(Boolean) || (/\blast\b/.test(clean.toLowerCase()) ? r.files.length : 0)
      const byName = r.files.find(f => words.filter(w => w.length > 2).some(w => f.name.toLowerCase().includes(w)))
      const pick = n && n <= r.files.length ? r.files[n - 1] : !/\b(open|find|search|from|in)\b/i.test(clean) ? byName : undefined
      if (pick) { setHeard(t); say(`Opening ${pick.name}.`, false); void openToken(pick); return }
      if (NO.test(clean)) { setResult(null); say('Okay, never mind.'); return }
    }
    if (uncertain) { setHeard(t); say(`Sorry, I didn't quite catch that — did you say “${t}”? Please say it again.`); return }
    void handleCommand(t)
  }

  const onOrb = () => {
    if (voice.speaking) { voice.stopSpeaking(); return }
    if (voice.mic === 'off' || voice.mic === 'error') {
      void voice.start()
      say(greetedOnce.current ? 'Yes, Doctor? How can I help?' : hello())
      greetedOnce.current = true
    } else voice.stop()
  }

  if (!doctor) return <Login onLogin={setDoctor} />
  const llm = !!health?.llm_configured
  const mode = orbMode(voice.mic, voice.speaking, thinking)

  return (
    <div className="relative min-h-full overflow-x-hidden bg-gradient-to-br from-slate-50 via-white to-brand-50">
      {/* soft animated background blobs */}
      <motion.div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand-200/40 blur-3xl" animate={{ x: [0, 40, 0], y: [0, 30, 0] }} transition={{ duration: 14, repeat: Infinity }} />
      <motion.div className="pointer-events-none absolute -right-32 top-40 h-96 w-96 rounded-full bg-violet-200/30 blur-3xl" animate={{ x: [0, -30, 0], y: [0, 40, 0] }} transition={{ duration: 16, repeat: Infinity }} />

      <input ref={fileInput} type="file" accept={ACCEPT} hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadFile(f) }} />

      <header className="relative z-10 mx-auto flex max-w-6xl items-center gap-3 px-5 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-600 text-white shadow"><Stethoscope size={20} /></div>
        <div className="mr-auto leading-tight">
          <div className="text-lg font-bold text-slate-900">MedLens AI</div>
          <div className="text-xs text-slate-500">Your voice medical assistant</div>
        </div>
        <span className={`chip ${llm ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${llm ? 'bg-emerald-500' : 'bg-rose-500'}`} />{llm ? 'AI ready' : health ? 'AI key missing' : 'Server offline'}
        </span>
        <button className="btn-ghost !py-1.5 !text-xs" onClick={onAdvanced} title="Full workspace"><LayoutGrid size={14} />Advanced</button>
        <button className="btn-ghost !px-2 !py-1.5" title="Sign out" onClick={() => { auth.set(null); voice.stop(); setDoctor(null) }}><LogOut size={14} /></button>
      </header>

      <main className="relative z-10 mx-auto grid max-w-6xl gap-6 px-5 pb-10 lg:grid-cols-[400px_1fr]">
        {/* ---------- voice column ---------- */}
        <section className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-3xl border border-white/60 bg-white/70 p-6 shadow-xl backdrop-blur">
            <VoiceOrb mode={mode} analyser={voice.analyserRef} disabled={!llm} onClick={onOrb} />
            <div className="mt-4 min-h-[110px] text-center">
              <AnimatePresence mode="wait">
                {heard && <motion.p key={'h' + heard} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-2 text-sm italic text-slate-400">“{heard}”</motion.p>}
              </AnimatePresence>
              <AnimatePresence mode="wait">
                <motion.p key={caption || 'empty'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="text-[15px] leading-relaxed text-slate-700">
                  {caption || (llm ? 'Tap the button and just talk — ask about symptoms, or tell me which report to open.' : 'Add GROQ_API_KEY to backend/.env to enable the assistant.')}
                </motion.p>
              </AnimatePresence>
              {voice.error && <p className="mt-2 text-xs text-rose-600">{voice.error}</p>}
            </div>
            {!caption && llm && (
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                {TRY.map(t => <button key={t} onClick={() => void handleCommand(t)} className="rounded-full bg-brand-50 px-3 py-1 text-xs text-brand-700 transition hover:bg-brand-100">“{t}”</button>)}
              </div>
            )}
            <form className="mt-4 flex gap-2" onSubmit={e => { e.preventDefault(); if (text.trim()) { void handleCommand(text.trim()); setText('') } }}>
              <input className="input !rounded-full !px-4" placeholder="…or type here" value={text} onChange={e => setText(e.target.value)} disabled={!llm} />
              <button className="btn-primary !rounded-full !px-3" disabled={!llm || !text.trim()} aria-label="Send"><Send size={16} /></button>
            </form>
          </div>
        </section>

        {/* ---------- upload + results column ---------- */}
        <section className="space-y-5">
          <motion.div
            onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void uploadFile(f) }}
            onClick={() => !upload && fileInput.current?.click()}
            animate={{ scale: drag ? 1.02 : 1 }}
            className={`cursor-pointer rounded-3xl border-2 border-dashed p-6 text-center transition ${drag ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-white/70 hover:border-brand-400 hover:bg-white'}`}>
            {upload ? (
              <div className="mx-auto max-w-sm">
                <div className="mb-2 flex items-center justify-between text-sm"><span className="truncate font-medium">{upload.name}</span>
                  <button className="btn-ghost !p-1" onClick={e => { e.stopPropagation(); upload.cancel() }}><X size={14} /></button></div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200"><motion.div className="h-full bg-brand-500" animate={{ width: `${upload.pct}%` }} /></div>
                <p className="mt-2 text-xs text-slate-500">{upload.pct < 100 ? `Uploading ${upload.pct}%` : 'Reading document…'}</p>
              </div>
            ) : (
              <>
                <motion.div animate={{ y: [0, -4, 0] }} transition={{ duration: 2.4, repeat: Infinity }} className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-100 text-brand-600"><UploadCloud size={26} /></motion.div>
                <div className="font-semibold text-slate-800">Upload a medical report</div>
                <div className="mt-0.5 text-sm text-slate-500">Drop a file here or click to browse · PDF, image, Word or text</div>
              </>
            )}
          </motion.div>

          <AnimatePresence>
            {busyNote && (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="flex items-center gap-2 rounded-2xl bg-brand-50 px-4 py-3 text-sm text-brand-800"><FolderOpen size={16} />{busyNote}<Loader2 size={14} className="ml-auto animate-spin" /></motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {!result && (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="rounded-3xl border border-white/60 bg-white/60 p-10 text-center text-slate-500 backdrop-blur">
                <Sparkles className="mx-auto mb-2 text-brand-400" />
                Results will appear here — report summary, possible conditions and test values.
              </motion.div>
            )}
            {result?.kind === 'report' && (
              <motion.div key={'r' + result.doc.id} className="rounded-3xl border border-white/60 bg-white/80 p-5 shadow-lg backdrop-blur" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <ReportResult doc={result.doc} analysis={result.analysis} stage={result.stage} onReadAloud={readAloud} onDownload={askDownload} downloading={downloading} />
              </motion.div>
            )}
            {result?.kind === 'symptoms' && (
              <motion.div key={'s' + result.input} className="rounded-3xl border border-white/60 bg-white/80 p-5 shadow-lg backdrop-blur" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <SymptomPanel result={result.data} busy={!result.data} input={result.input} />
              </motion.div>
            )}
            {result?.kind === 'answer' && (
              <motion.div key={'a' + result.q} className="space-y-3 rounded-3xl border border-white/60 bg-white/80 p-5 shadow-lg backdrop-blur" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div className="flex items-center gap-2 font-semibold"><BookOpen size={17} className="text-brand-600" />{result.q}</div>
                {result.answer ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{result.answer}</p>
                  : <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={15} className="animate-spin" />Searching medical literature…</p>}
                {result.evidence.length > 0 && <details><summary className="cursor-pointer text-xs font-semibold text-slate-500">Sources ({result.evidence.length})</summary><div className="mt-2"><EvidenceList evidence={result.evidence} /></div></details>}
              </motion.div>
            )}
            {result?.kind === 'files' && (
              <motion.div key="files" className="rounded-3xl border border-white/60 bg-white/80 p-5 shadow-lg backdrop-blur" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
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
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>

      {confirm && <ConfirmDialog title={confirm.title} message={confirm.message} onCancel={() => setConfirm(null)} onConfirm={() => { const c = confirm; setConfirm(null); c.run() }} />}
    </div>
  )
}
