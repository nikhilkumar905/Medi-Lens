import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft, BookOpen, Camera, ChevronRight, FileText, FolderOpen, HeartPulse, Home, Image as ImageIcon, Loader2,
  LogOut, Mic, RotateCcw, Send, UploadCloud, X,
} from 'lucide-react'
import { api, auth, saveBlob, shrinkImage, uploadDocument, ApiError, type FoundFile } from './services/api'
import type { Analysis, DiseaseInfo, Doc, Evidence, Health, ImageDiagnosis, SymptomResult, VoiceAction } from './types'
import { ImageDiagnosisView, ImageIntake } from './components/ImageDiagnosis'
import { LanguageSwitch, isNative, localize, useLang, useTranslated } from './i18n'
import { useVoice } from './hooks/useVoice'
import VoiceOrb, { orbMode } from './components/VoiceOrb'
import ReportResult from './components/ReportResult'
import SymptomPanel from './components/SymptomPanel'
import BodyHero from './components/BodyHero'
import { DiseaseIntake, DiseaseView } from './components/DiseasePanel'
import { BODY_PART_LABELS } from './components/AnatomyViewer'
import { EvidenceList } from './components/AnalysisPanel'
import { CameraCapture, ConfirmDialog, Login, type CameraHandle } from './components/Overlays'

type Step = 'home' | 'menu' | 'report' | 'upload' | 'disease' | 'image'

type Result =
  | { kind: 'report'; doc: Doc; analysis: Analysis | null; stage: 'extracting' | 'analyzing' | 'interpreting' | 'done' }
  | { kind: 'symptoms'; input: string; data: SymptomResult | null }
  | { kind: 'disease'; input: string; data: DiseaseInfo | null }
  | { kind: 'answer'; q: string; answer: string | null; evidence: Evidence[] }
  | { kind: 'files'; folder: string; files: FoundFile[]; photo?: boolean }
  | { kind: 'image'; preview: string; data: ImageDiagnosis | null }
  | null

interface Msg { role: 'user' | 'assistant'; content: string }

/** Normalise an utterance to " word word " so whole words/phrases in any script can be matched with includes(). */
const norm = (s: string) => ' ' + s.toLowerCase().replace(/[,.!?।|"“”']+/g, ' ').replace(/\s+/g, ' ').trim() + ' '
const hasAny = (s: string, words: string[]) => { const n = norm(s); return words.some(w => n.includes(' ' + w + ' ')) }
const isOnly = (s: string, words: string[]) => words.includes(norm(s).trim())
const startsWithAny = (s: string, words: string[]) => { const n = norm(s); return words.some(w => n.startsWith(' ' + w + ' ')) }

// English, Hindi (Devanagari + Latin), Telugu
const W = {
  yes: ['yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'confirm', 'go ahead', 'do it', 'please do', 'हाँ', 'हां', 'हा', 'जी', 'जी हाँ', 'ठीक है', 'हाँ जी', 'haan', 'han', 'ji', 'theek hai', 'అవును', 'సరే', 'అవునండి', 'avunu', 'sare'],
  no: ['no', 'nope', 'cancel', "don't", 'dont', 'never mind', 'nevermind', 'stop', 'नहीं', 'नही', 'ना', 'मत', 'रद्द', 'रहने दो', 'nahi', 'nahin', 'na', 'కాదు', 'వద్దు', 'లేదు', 'రద్దు', 'vaddu', 'kaadu'],
  one: ['one', '1', 'first', 'एक', 'पहला', 'पहले', 'ek', 'pehla', 'ఒకటి', 'ఒకటో', 'మొదటి', 'మొదటిది', 'okati'],
  two: ['two', '2', 'second', 'दो', 'दूसरा', 'दूसरे', 'doosra', 'రెండు', 'రెండో', 'రెండవ', 'రెండవది', 'rendu'],
  three: ['three', '3', 'third', 'तीन', 'तीसरा', 'तीसरे', 'teen', 'teesra', 'మూడు', 'మూడో', 'మూడవ', 'మూడవది', 'moodu'],
  back: ['back', 'go back', 'previous', 'वापस', 'पीछे', 'वापस जाओ', 'पीछे जाओ', 'wapas', 'peeche', 'వెనక్కి', 'వెనుకకు', 'వెనక్కి వెళ్ళు', 'venakki'],
  home: ['home', 'start over', 'main menu', 'होम', 'शुरुआत', 'मुख्य मेनू', 'హోమ్', 'మొదటికి', 'ప్రధాన మెను'],
  read: ['read', 'read it', 'read the results', 'read aloud', 'read results', 'पढ़ो', 'पढ़कर सुनाओ', 'सुनाओ', 'नतीजे सुनाओ', 'padho', 'sunao', 'చదువు', 'చదివి వినిపించు', 'వినిపించు', 'ఫలితాలు చదువు'],
  capture: ['capture', 'take', 'click', 'snap', 'shoot', 'scan it', 'कैप्चर', 'फोटो लो', 'फ़ोटो लो', 'खींचो', 'फोटो खींचो', 'क्लिक', 'క్యాప్చర్', 'తీయి', 'తీయండి', 'ఫోటో తీయి', 'క్లిక్'],
  hello: ['help', 'hello', 'hi', 'hey', 'start', 'begin', 'मदद', 'सहायता', 'नमस्ते', 'हेलो', 'शुरू', 'madad', 'namaste', 'సహాయం', 'నమస్కారం', 'హలో', 'ప్రారంభించు'],
  photo: ['photo', 'picture', 'image', 'injury', 'injured', 'wound', 'skin', 'rash', 'फोटो', 'फ़ोटो', 'तस्वीर', 'चोट', 'घाव', 'त्वचा', 'चकत्ते', 'ఫోటో', 'గాయం', 'దెబ్బ', 'చర్మం', 'దద్దుర్లు'],
  report: ['report', 'analyze', 'analyse', 'रिपोर्ट', 'जाँच', 'जांच', 'రిపోర్ట్', 'నివేదిక'],
  disease: ['disease', 'symptom', 'symptoms', 'ask', 'advice', 'recommendation', 'बीमारी', 'लक्षण', 'सलाह', 'रोग', 'వ్యాధి', 'లక్షణాలు', 'సలహా', 'రోగం'],
  camera: ['camera', 'scan', 'photo', 'show', 'कैमरा', 'फोटो', 'फ़ोटो', 'दिखाओ', 'కెమెరా', 'ఫోటో', 'చూపించు'],
  upload: ['upload', 'file', 'browse', 'अपलोड', 'फ़ाइल', 'फाइल', 'అప్‌లోడ్', 'ఫైల్'],
  // a photo word together with a "pick it from the computer" verb means: open the photo picker
  photoWord: ['photo', 'photos', 'image', 'images', 'picture', 'pictures', 'pic', 'pics', 'फ़ोटो', 'फोटो', 'तस्वीर', 'इमेज', 'चित्र',
    'ఫోటో', 'ఫోటోను', 'చిత్రం', 'ఇమేజ్'],
  pickVerb: ['upload', 'browse', 'choose', 'select', 'pick', 'open', 'attach', 'gallery', 'computer', 'अपलोड', 'चुनो', 'चुनें', 'खोलो',
    'लगाओ', 'అప్‌లోడ్', 'అప్లోడ్', 'ఎంచుకో', 'ఎంచుకోండి', 'తెరువు', 'జోడించు'],
  cameraOnly: ['camera', 'webcam', 'कैमरा', 'కెమెరా'],
  // on the photo step these alone mean "pick a photo from the computer"
  photoAlone: ['image', 'images', 'picture', 'pictures', 'gallery', 'इमेज', 'तस्वीर', 'చిత్రం', 'ఇమేజ్'],
  stop: ['stop', 'stop speaking', 'be quiet', 'silence', 'रुको', 'चुप', 'बस', 'ఆపు', 'ఆగు', 'చాలు'],
  // a short utterance containing any of these means "open the file picker"
  fileOnly: ['file', 'files', 'upload', 'upload file', 'upload a file', 'upload the file', 'browse', 'document', 'pdf', 'open file', 'choose file', 'select file', 'pick file',
    'फ़ाइल', 'फाइल', 'अपलोड', 'फ़ाइल अपलोड', 'फाइल अपलोड', 'फ़ाइल खोलो', 'फाइल खोलो', 'file upload', 'file kholo', 'dastavez', 'दस्तावेज़',
    'ఫైల్', 'ఫైలు', 'అప్‌లోడ్', 'అప్లోడ్', 'ఫైల్ అప్‌లోడ్', 'ఫైల్ తెరువు', 'డాక్యుమెంట్'],
}
// polite / filler words ignored when deciding whether an utterance is *only* "file" / "upload"
const FILLER = new Set(['a', 'an', 'the', 'please', 'plz', 'my', 'me', 'can', 'could', 'you', 'i', 'want', 'to', 'do', 'it', 'now', 'ok', 'okay',
  'करो', 'कर', 'करें', 'कीजिए', 'दो', 'मेरी', 'मेरा', 'एक', 'अभी', 'karo', 'kar', 'karna', 'hai', 'है', 'करना',
  'చేయి', 'చేయండి', 'చెయ్యి', 'నా', 'ఒక', 'ఇప్పుడు', 'చెయ్యండి'])
const withoutFiller = (s: string) => norm(s).trim().split(' ').filter(w => !FILLER.has(w)).join(' ')

// Speech recognition often mishears a lone "file" ("fine", "pail", "pile"...). These sound-alikes count as "file"
// when the whole utterance is just one to three such words, on screens where uploading makes sense.
const HESITATION = new Set(['el', 'al', 'uh', 'um', 'umm', 'oh', 'ah', 'er', 'hmm'])
const FILE_ALIKE = new Set(['fine', 'pile', 'pail', 'pale', 'fail', 'phile', 'fyle', 'while', 'vile', 'mile', 'tile', 'feel', 'fill',
  'foil', 'filed', 'files', 'fire', 'fly', 'fild', 'phyl', 'फायल', 'फाईल', 'फ़ाईल', 'पाइल', 'फाइलें', 'ఫైలు', 'పైల్', 'ఫైల'])
function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
const fileish = (w: string) => FILE_ALIKE.has(w) || (w.length >= 3 && w.length <= 5 && w !== 'five' && w !== 'fever' && lev(w, 'file') <= 1)
const uploadish = (w: string) => w.length >= 5 && lev(w, 'upload') <= 2
/** "fine", "the pile", "uh pail", "uplod a fine" … → true */
function soundsLikeFileCommand(s: string): boolean {
  const words = withoutFiller(s).split(' ').filter(w => w && !HESITATION.has(w))
  return words.length >= 1 && words.length <= 3 && words.some(fileish) && words.every(w => fileish(w) || uploadish(w))
}
/** "upload image", "choose a photo", "फ़ोटो अपलोड करो", "ఫోటో అప్‌లోడ్ చేయండి" — but not "take a photo with the camera". */
const wantsPhotoUpload = (s: string) => hasAny(s, W.photoWord) && hasAny(s, W.pickVerb) && !hasAny(s, W.cameraOnly) && !hasAny(s, W.capture)
/** A folder named in a short command ("upload the photo from Downloads") so the picker opens there. */
const FOLDER_WORDS: [string[], string][] = [
  [['downloads', 'download', 'डाउनलोड', 'डाउनलोड्स', 'డౌన్‌లోడ్స్', 'డౌన్లోడ్స్', 'డౌన్‌లోడ్'], 'Downloads'],
  [['desktop', 'डेस्कटॉप', 'డెస్క్‌టాప్'], 'Desktop'], [['documents', 'डॉक्यूमेंट्स', 'డాక్యుమెంట్స్'], 'Documents'],
  [['pictures', 'पिक्चर्स', 'పిక్చర్స్'], 'Pictures'],
]
const folderIn = (s: string) => FOLDER_WORDS.find(([w]) => hasAny(s, w))?.[1]
const PHOTO_NOISE = new Set(['from', 'in', 'on', 'of', 'at', 'for', 'folder', 'file', 'this', 'that', 'with', 'here', 'computer', 'pc', 'laptop',
  'से', 'में', 'की', 'का', 'के', 'को', 'वाली', 'वाला', 'फ़ोल्डर', 'फोल्डर', 'నుండి', 'లో', 'యొక్క', 'ని', 'ను', 'ఫోల్డర్'])
/** Words describing a particular photo ("upload the photo of my rash from Downloads" → "rash"); '' if none. */
const photoDescription = (s: string) => withoutFiller(s).split(' ').filter(w => w && !PHOTO_NOISE.has(w) && !HESITATION.has(w) &&
  !W.photoWord.includes(w) && !W.pickVerb.includes(w) && !FOLDER_WORDS.some(([fw]) => fw.includes(w))).join(' ')

const ORDINALS: Record<string, number> = { first: 1, one: 1, '1': 1, second: 2, two: 2, '2': 2, third: 3, three: 3, '3': 3,
  fourth: 4, four: 4, '4': 4, fifth: 5, five: 5, '5': 5, sixth: 6, six: 6, '6': 6,
  'एक': 1, 'पहला': 1, 'दो': 2, 'दूसरा': 2, 'तीन': 3, 'तीसरा': 3, 'चार': 4, 'पाँच': 5, 'पांच': 5, 'छह': 6,
  'ఒకటి': 1, 'మొదటి': 1, 'రెండు': 2, 'రెండో': 2, 'మూడు': 3, 'మూడో': 3, 'నాలుగు': 4, 'ఐదు': 5, 'ఆరు': 6 }
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.docx,.txt'

const PROMPT: Record<Step, string> = {
  home: '',
  menu: 'How can I help? Say "one" for a medical report, "two" for a disease or symptoms, or "three" for a photo of a disease or injury.',
  report: 'Would you like to upload a file, or show the report to the camera?',
  upload: 'Drop the file here or click to browse. You can also tell me where it is, like "the CBC report in Downloads".',
  disease: 'Tell me your symptoms, or name a disease you want to know about.',
  image: 'Upload or take a close-up photo of the skin problem, wound or injury, and I will predict what it might be.',
}
const PARENT: Record<Step, Step> = { home: 'home', menu: 'home', report: 'menu', upload: 'report', disease: 'menu', image: 'menu' }
const TRAIL: Record<Step, string[]> = {
  home: [], menu: ['How can I help'], report: ['How can I help', 'Analyze report'],
  upload: ['How can I help', 'Analyze report', 'Upload file'], disease: ['How can I help', 'Disease & advice'], image: ['How can I help', 'Photo of disease / injury'],
}
const TRY: Record<Step, string[]> = {
  home: ['I need help'],
  menu: ['Analyze my medical report', 'Ask about a disease', 'Check a photo of an injury'],
  report: ['Upload a file', 'Use the camera'],
  upload: ['Open the CBC report from Downloads', 'Analyze the latest report on my desktop', 'Read the results'],
  disease: ['I have fever and headache for 3 days', 'Tell me about diabetes', 'How do I prevent dengue?'],
  image: ['Upload image', 'Take a photo', 'Read the results'],
}

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning!' : h < 17 ? 'Good afternoon!' : 'Good evening!'
}

/** Voice-only step: shows what the assistant asked and that it is listening; the user answers by voice. */
function VoiceStage({ question, heard, mode, children }: { question: string; heard: string | null; mode: string; children?: React.ReactNode }) {
  const { t } = useLang()
  const status = mode === 'speaking' ? t('Speaking — tap to stop') : mode === 'hearing' ? t('Hearing you…') : mode === 'thinking' ? t('Thinking…')
    : mode === 'listening' ? t("I'm listening…") : mode === 'paused' ? t('Paused: not listening. Tap to resume') : t('Tap to talk')
  return (
    <div className="grid items-center gap-6 md:grid-cols-[220px_1fr]">
      <div className="hidden md:block">{children}</div>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-3xl border border-white/70 bg-white/85 p-8 text-center shadow-lg backdrop-blur">
        <div className="mx-auto mb-5 flex h-24 items-end justify-center gap-1.5" aria-hidden>
          {[0, 1, 2, 3, 4, 5, 6].map(i => (
            <motion.span key={i} className={`w-2.5 rounded-full ${mode === 'speaking' ? 'bg-violet-500' : 'bg-brand-500'}`}
              animate={{ height: mode === 'listening' || mode === 'hearing' || mode === 'speaking' ? [14, 40 + (i % 3) * 22, 14] : 14 }}
              transition={{ duration: mode === 'hearing' ? 0.5 : 1.1, repeat: Infinity, delay: i * 0.09, ease: 'easeInOut' }} />
          ))}
        </div>
        <p className="text-xl font-semibold leading-relaxed text-slate-900 sm:text-2xl">{question}</p>
        <AnimatePresence>{heard && <motion.p key={heard} initial={{ opacity: 0 }} animate={{ opacity: 1 }} translate="no" className="mt-4 text-sm italic text-slate-400">“{heard}”</motion.p>}</AnimatePresence>
        <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-brand-50 px-4 py-1.5 text-sm font-medium text-brand-700"><Mic size={15} />{status}</div>
      </motion.div>
    </div>
  )
}

const Panel = ({ children, k }: { children: React.ReactNode; k: string }) => (
  <motion.div key={k} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}
    className="rounded-3xl border border-white/60 bg-white/85 p-5 shadow-lg backdrop-blur">
    {children}
  </motion.div>
)

export default function SimpleApp() {
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
  const cameraFor = useRef<'report' | 'image'>('report')
  const [captured, setCaptured] = useState<Blob | null>(null)
  const { speech, lang, t } = useLang()
  /** Body-part name as it should appear inside a sentence. */
  const partName = (p: string) => (lang === 'en' ? BODY_PART_LABELS[p].toLowerCase() : t(BODY_PART_LABELS[p]))
  // translated copy of what is on screen, so "read aloud" speaks the chosen language (shares the cache with the cards)
  const shown = result?.kind === 'report' ? (result.analysis?.interpretation ? { ...result.analysis.interpretation, evidence: undefined } : null)
    : result && 'data' in result ? result.data : null
  const tr = useTranslated<Record<string, unknown>>(shown as Record<string, unknown> | null)

  const R = useRef({ result, confirm, upload, messages, step, camera, area, tr: tr.data, lang, speech })
  R.current = { result, confirm, upload, messages, step, camera, area, tr: tr.data, lang, speech }

  const voice = useVoice({ onUtterance: (u, unc) => onUtterance(u, unc), language: lang === 'en' ? undefined : speech, sttLanguage: lang })
  // Everything the assistant says goes through one ordered queue and is shown + spoken in the chosen language.
  const sayQueue = useRef<Promise<void>>(Promise.resolve())
  const say = useCallback((msg: string, speak = true) => {
    if (!msg) return
    const L = R.current.lang
    sayQueue.current = sayQueue.current.then(async () => {
      const out = isNative(msg, L) ? msg : await localize(msg, L)
      setCaption(out)
      setMessages(m => [...m, { role: 'assistant', content: out }])
      if (speak) void voice.speak(out)
    })
  }, [voice])

  useEffect(() => { auth.onUnauthorized(() => { setDoctor(null); voice.stop() }) }, [voice])
  // switching language mid-conversation: show the assistant's last message in the new language too
  const captionRef = useRef(caption)
  captionRef.current = caption
  useEffect(() => {
    const c = captionRef.current
    if (!c || isNative(c, lang) && lang !== 'en') return
    let alive = true
    void localize(c, lang).then(x => { if (alive && captionRef.current === c) setCaption(x) })
    return () => { alive = false }
  }, [lang])
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
    if (speak && PROMPT[s]) say(`${prefix}${t(PROMPT[s])}`)
  }
  const back = () => { setCamera(false); goStep(PARENT[R.current.step], false) }

  const begin = (part: string | null) => {
    setArea(part)
    if (llm) { if (voice.paused) void voice.resume(); else micOn() }
    setResult(null)
    goStep('menu', true, part ? `${t('You picked the {part}.', { part: partName(part) })} ` : `${t(greeting())} `)
  }

  const openCamera = (speak = true, purpose: 'report' | 'image' = R.current.step === 'image' ? 'image' : 'report') => {
    cameraFor.current = purpose
    if (purpose === 'report') setStep('report')
    setCamera(true)
    if (speak) say(t(purpose === 'image' ? 'Point the camera at the affected area in good light, then say "capture" or tap Capture.' : 'Hold the report flat in front of the camera, then say "capture" or tap Capture.'))
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
        const abn = a.structured.rows.filter(x => ['high', 'low', 'abnormal'].includes(x.evaluation.status))
        say(`I extracted ${a.structured.rows.length} values${abn.length ? `; ${abn.map(x => `${x.test_name} is ${x.evaluation.status}`).join(', ')}` : ''}. I couldn't add the explanation: ${(e as Error).message}`)
      }
    } catch (e) {
      setReport({ stage: 'done' })
      say(`I couldn't analyze it: ${(e as Error).message}`)
    }
  }

  const uploadFile = async (file: File | Blob, name: string) => {
    closeFileDialog()
    setStep('upload')
    const u = uploadDocument(file, name, 'report', null, pct => setUpload(x => x && { ...x, pct }))
    setUpload({ name, pct: 0, cancel: u.cancel })
    try { await processDoc(await u.promise) }
    catch (e) { if (!(e instanceof ApiError && e.status === -1)) say(`Upload failed: ${(e as Error).message}`) }
    finally { setUpload(null) }
  }

  const onCapture = (b: Blob) => {
    setCamera(false)
    if (cameraFor.current === 'image') { setCaptured(b); say('Got the photo. Add any notes if you like, then tap Predict condition.', false); return }
    say('Captured. Let me read it.', false)
    void uploadFile(b, `camera_report_${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`)
  }

  const openToken = async (f: FoundFile) => {
    closeFileDialog()
    setBusyNote(`Opening ${f.name}…`)
    try { await processDoc(await api.openFound(f.token)) }
    catch (e) { say(`I couldn't open that file: ${(e as Error).message}`) }
    finally { setBusyNote(null) }
  }

  const findAndOpen = async (location?: string, query?: string) => {
    closeFileDialog()
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

  // The native "Open file" dialog (opened by voice) stays on screen until the user picks. If the file arrives
  // another way (named by voice, dropped, camera), close the dialog automatically.
  const dialogOpen = useRef(false)
  // Every dialog gets a number. When the app closes a dialog itself the number moves on, so the old request's
  // late "cancelled" answer is ignored instead of being announced.
  const dialogSeq = useRef(0)
  const closeFileDialog = () => {
    if (!dialogOpen.current) return
    dialogSeq.current++
    dialogOpen.current = false
    setBusyNote(null)
    void api.cancelPick().catch(() => { /* dialog already gone */ })
  }

  const openPicker = async (location?: string) => {
    setStep('upload')
    const clicked = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive
    if (clicked && fileInput.current) { fileInput.current.click(); return }
    if (!health?.local_file_dialog) { say('Click the upload box to choose the file.'); return }
    setBusyNote('A file browser is open on your computer. Choose the report, or just tell me its name and I will open it for you.')
    say('I opened the file browser. Pick the report, or just tell me its name, like "the CBC report in Downloads".')
    const my = ++dialogSeq.current
    dialogOpen.current = true
    try {
      const d = await api.pickLocal('report', null, location)
      if (my !== dialogSeq.current) return // the file was opened another way; stay quiet
      dialogOpen.current = false
      setBusyNote(null)
      if (d.cancelled) { say('No file chosen. Tell me whenever you’re ready.'); return }
      await processDoc(d)
    } catch (e) {
      if (my !== dialogSeq.current) return
      dialogOpen.current = false
      setBusyNote(null)
      say(e instanceof ApiError && (e.status === 403 || e.status === 501) ? 'I can’t open the file browser from here. Please use the upload box.' : `Upload failed: ${(e as Error).message}`)
    }
  }

  /** Voice "upload image": open a photo dialog on this computer and analyse the chosen photo automatically. */
  const openPhotoPicker = async (location?: string, intro?: string) => {
    setStep('image')
    if (!health?.local_file_dialog) { say('Click the photo box to choose the image.'); return }
    if (dialogOpen.current) { say('The file browser is already open. Choose the photo, or tell me its name.'); return }
    setBusyNote('A file browser is open on your computer. Choose the photo of the problem area, or just tell me its name (check the taskbar if you don’t see it).')
    say(intro || 'I opened the file browser. Choose the photo, or tell me its name, like "the rash photo in Downloads".')
    const my = ++dialogSeq.current
    dialogOpen.current = true
    try {
      const r = await api.pickPhoto(location)
      if (my !== dialogSeq.current) return // the photo arrived another way; stay quiet
      dialogOpen.current = false
      setBusyNote(null)
      if (!(r instanceof Blob)) { say('No photo chosen. Tell me whenever you’re ready.'); return }
      await runImage(r, '')
    } catch (e) {
      if (my !== dialogSeq.current) return
      dialogOpen.current = false
      setBusyNote(null)
      say(e instanceof ApiError && (e.status === 403 || e.status === 501) ? 'I can’t open the file browser from here. Please click the photo box.' : `I couldn't open the photo: ${(e as Error).message}`)
    }
  }

  const openFoundPhoto = async (f: FoundFile) => {
    closeFileDialog()
    setBusyNote(`Opening ${f.name}…`)
    let blob: Blob
    try { blob = await api.openFoundPhoto(f.token) } catch (e) { setBusyNote(null); say(`I couldn't open that photo: ${(e as Error).message}`); return }
    setBusyNote(null)
    await runImage(blob, '')
  }

  /** Voice "the rash photo in Downloads" on the photo step: find photos by name and analyse the match. */
  const findAndOpenPhoto = async (location?: string, query?: string) => {
    closeFileDialog()
    setStep('image')
    const q = (query || '').trim()
    setBusyNote(`Looking for ${q && !/^(latest|newest|recent)$/i.test(q) ? `the photo “${q}”` : 'the latest photo'}${location ? ` in ${location}` : ''}…`)
    try {
      const r = await api.findPhotos(location || undefined, q)
      setBusyNote(null)
      if (r.error) { await openPhotoPicker(undefined, `${r.error} I opened the file browser instead, so you can choose the photo there.`); return }
      if (!r.candidates.length) { await openPhotoPicker(location, `I couldn't find a photo matching “${q || 'that'}” in ${r.folder}, so I opened the file browser. Choose the photo there.`); return }
      if (r.confident) { say(`Found ${r.candidates[0].name}.`, false); await openFoundPhoto(r.candidates[0]); return }
      setResult({ kind: 'files', folder: r.folder, files: r.candidates, photo: true })
      say(`I found ${r.candidates.length} photos in ${r.folder}. ${r.candidates.slice(0, 3).map((c, i) => `Number ${i + 1}: ${c.name.replace(/\.[^.]+$/, '')}`).join('. ')}. Which one should I open?`)
    } catch (e) {
      setBusyNote(null)
      say(`I couldn't search for photos: ${(e as Error).message}`)
    }
  }

  /** "Which file?" list for reports and photos; tap one or say "number 2". */
  const filesPanel = (res: Extract<Result, { kind: 'files' }>) => (
    <Panel k={res.photo ? 'photo-files' : 'files'}>
      <div className="mb-3 text-sm font-semibold">{t(res.photo ? 'Which photo?' : 'Which file?')} <span className="font-normal text-slate-500">{t('Say “number 2” or tap one')} · {res.folder}</span></div>
      <div className="space-y-2">
        {res.files.map((f, i) => (
          <motion.button key={f.token} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
            onClick={() => void (res.photo ? openFoundPhoto(f) : openToken(f))} className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left transition hover:border-brand-400 hover:shadow">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">{i + 1}</span>
            {res.photo ? <ImageIcon size={18} className="shrink-0 text-slate-400" /> : <FileText size={18} className="shrink-0 text-slate-400" />}
            <span className="min-w-0 flex-1"><span className="block truncate font-medium" data-no-translate>{f.name}</span>
              <span className="block truncate text-xs text-slate-400" data-no-translate>{f.folder} · {new Date(f.modified * 1000).toLocaleDateString()}</span></span>
          </motion.button>
        ))}
      </div>
    </Panel>
  )

  // ---------------- photo of disease / injury ----------------
  const runImage = async (file: Blob, notes: string) => {
    closeFileDialog()
    setStep('image')
    let small: Blob
    try { small = await shrinkImage(file) } catch (e) { say((e as Error).message); return }
    const preview = URL.createObjectURL(small)
    setResult({ kind: 'image', preview, data: null })
    say('Let me take a close look at the photo.', false)
    try {
      const r = await api.analyzePhoto(small, 'photo.jpg', R.current.area ? BODY_PART_LABELS[R.current.area] : null, notes)
      setResult({ kind: 'image', preview, data: r })
      setCaptured(null)
      if (!r.is_medical_image) say(r.quality_issue || "That doesn't look like a photo of a health problem. Please try a clear close-up of the affected area.")
      else say(`${r.spoken_summary || 'Here is what I see.'} Say "read the results" to hear the precautions.`)
    } catch (e) { setResult(null); say(`Sorry, I couldn't analyze the photo: ${(e as Error).message}`) }
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
    const local = R.current.lang !== 'en' && R.current.tr ? R.current.tr : null
    if (local) {
      // speak the translated card text in the selected language
      const arr = (k: string) => (Array.isArray(local[k]) ? (local[k] as string[]).slice(0, 3).join('. ') : '')
      const text = [local.spoken_summary || local.summary || local.overview, arr('precautions'), arr('home_care'), arr('avoid'), arr('see_doctor_if')]
        .filter(Boolean).join('. ')
      if (text) { say(String(text)); return }
    }
    const list = (label: string, xs?: string[]) => (xs?.length ? ` ${label}: ${xs.slice(0, 3).join('. ')}.` : '')
    if (r?.kind === 'image' && r.data) {
      say((r.data.spoken_summary || '') + list('Precautions', r.data.precautions) + list('Home care', r.data.home_care) + list('See a doctor quickly if', r.data.see_doctor_if))
      return
    }
    if (r?.kind === 'report' && r.analysis) {
      const it = r.analysis.interpretation
      const abn = r.analysis.structured.rows.filter(x => ['high', 'low', 'abnormal'].includes(x.evaluation.status))
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

  const askDownload = () => setConfirm({ title: 'Approve & download report', message: 'Do you approve this analysis and want to download it as a PDF?', run: approveAndDownload })

  const askFollowUp = (q: string) => { micOn(); say(q) }

  // ---------------- voice ----------------
  const dispatch = (a: VoiceAction) => {
    const args = a.args
    switch (a.name) {
      case 'navigate_to': {
        const s = args.step
        if (s === 'camera') openCamera(false)
        else if (s === 'home' || s === 'menu' || s === 'report' || s === 'upload' || s === 'disease' || s === 'image') goStep(s, false)
        return
      }
      case 'ask_about_disease': void runDisease(args.disease); return
      case 'open_file_from_computer':
        if (R.current.step === 'image') void findAndOpenPhoto(args.location, args.file_query)
        else void findAndOpen(args.location, args.file_query)
        return
      case 'open_report_upload': if (R.current.step === 'image') void openPhotoPicker(args.location); else void openPicker(args.location); return
      case 'open_photo_upload': void openPhotoPicker(args.location); return
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
      case 'cancel_current_operation': R.current.upload?.cancel(); closeFileDialog(); setBusyNote(null); setCamera(false); say('Cancelled.', false); return
      case 'go_back': back(); return
      default: say("Sorry, I can't do that here.")
    }
  }

  const handleCommand = async (t: string) => {
    setHeard(t)
    setMessages(m => [...m, { role: 'user', content: t }])
    if (isOnly(t, W.stop)) { voice.stopSpeaking(); return }
    setThinking(true)
    try {
      const r = R.current.result
      const ctx = {
        view: 'guided', step: R.current.step, camera_open: R.current.camera, file_dialog_open: dialogOpen.current, body_area: R.current.area,
        document: r?.kind === 'report' ? r.doc.filename : null, has_analysis: !!currentAnalysis(),
        showing: r?.kind || 'nothing', file_choices: r?.kind === 'files' ? r.files.map(f => f.name) : undefined,
      }
      const res = await api.command(t, R.current.messages.slice(-10), ctx, R.current.lang)
      const silent = res.actions.some(x => ['stop_speaking', 'repeat_last_answer', 'read_results_aloud', 'explain_medical_findings', 'retrieve_medical_evidence'].includes(x.name))
      if (res.reply) say(res.reply, !silent)
      res.actions.forEach(dispatch)
    } catch (e) { say(`Sorry, ${(e as Error).message}`) } finally { setThinking(false) }
  }

  /** Quick local handling of short navigation phrases, so stepping through the flow by voice is instant. */
  const quickNav = (clean: string): boolean => {
    const s = clean
    const wordCount = norm(s).trim().split(' ').length
    if (wordCount > 12) return false
    const st = R.current.step
    // A photo word plus an upload word ("please upload the photo of my rash from Downloads") is unambiguous even in a
    // longer sentence. If a particular photo is described ("rash"), look for it first; otherwise open the photo picker.
    if (['image', 'menu', 'home'].includes(st) && !R.current.camera && wantsPhotoUpload(s)) {
      if (dialogOpen.current) { say('The file browser is already open. Choose the photo, or tell me its name.'); return true }
      const described = photoDescription(s)
      if (described) void findAndOpenPhoto(folderIn(s), described)
      else void openPhotoPicker(folderIn(s))
      return true
    }
    if (wordCount > 6) return false
    if (R.current.camera && hasAny(s, W.capture)) { cameraRef.current?.capture(); return true }
    if (isOnly(s, W.back)) { back(); return true }
    if (st !== 'image' && !R.current.camera && (W.fileOnly.includes(withoutFiller(s)) ||
      (['menu', 'report', 'upload'].includes(st) && soundsLikeFileCommand(s)))) {
      if (dialogOpen.current) { say('The file browser is already open. Pick the report, or tell me its name.'); return true }
      void openPicker(); return true
    }
    // photo step: "upload image", "file", "browse", "image", "फ़ोटो अपलोड करो"… → photo picker, analysed automatically
    if (st === 'image' && !R.current.camera && (W.fileOnly.includes(withoutFiller(s)) || soundsLikeFileCommand(s) ||
      W.photoAlone.includes(withoutFiller(s)))) {
      if (dialogOpen.current) { say('The file browser is already open. Choose the photo, or tell me its name.'); return true }
      void openPhotoPicker(folderIn(s)); return true
    }
    if (hasAny(s, W.home)) { goStep('home', false); say(t('Back to the start. Tap the body or say "I need help".')); return true }
    if (isOnly(s, W.read)) { readAloud(); return true }
    if (st === 'home' && hasAny(s, W.hello)) { goStep('menu', true, `${t(greeting())} `); return true }
    if ((st === 'menu' || st === 'home') && (hasAny(s, W.three) || hasAny(s, W.photo))) { goStep('image'); return true }
    if (st === 'image' && (hasAny(s, W.camera) || hasAny(s, W.capture))) { openCamera(true, 'image'); return true }
    if (st === 'menu') {
      if (hasAny(s, W.one) || hasAny(s, W.report)) { goStep('report'); return true }
      if (hasAny(s, W.two) || hasAny(s, W.disease)) { goStep('disease'); return true }
    }
    if (st === 'report') {
      if (hasAny(s, W.camera) || hasAny(s, W.two)) { openCamera(); return true }
      if (hasAny(s, W.upload) || hasAny(s, W.one)) { goStep('upload'); return true }
    }
    return false
  }

  function onUtterance(heardText: string, uncertain: boolean) {
    const clean = heardText.trim().replace(/[.!?]+$/, '')
    const c = R.current.confirm
    if (c) {
      setHeard(heardText)
      if (startsWithAny(clean, W.yes)) { setConfirm(null); c.run() } else if (startsWithAny(clean, W.no)) { setConfirm(null); say(t('Okay.')) } else say(t('Please say yes or no.'))
      return
    }
    const r = R.current.result
    if (r?.kind === 'files') {
      const words = norm(clean).trim().split(' ')
      const n = words.map(w => ORDINALS[w]).find(Boolean) || (/\blast\b/.test(clean.toLowerCase()) ? r.files.length : 0)
      const byName = r.files.find(f => words.filter(w => w.length > 2).some(w => f.name.toLowerCase().includes(w)))
      const pick = n && n <= r.files.length ? r.files[n - 1] : !/\b(open|find|search|from|in)\b/i.test(clean) ? byName : undefined
      if (pick) { setHeard(heardText); say(`Opening ${pick.name}.`, false); void (r.photo ? openFoundPhoto(pick) : openToken(pick)); return }
      if (startsWithAny(clean, W.no)) { setResult(null); say('Okay, never mind.'); return }
    }
    if (uncertain) { setHeard(heardText); say(`Sorry, I didn't quite catch that. Did you say “${heardText}”? Please say it again.`); return }
    if (quickNav(clean)) { setHeard(heardText); setMessages(m => [...m, { role: 'user', content: heardText }]); return }
    void handleCommand(heardText)
  }

  const onOrb = () => {
    if (voice.speaking) { voice.stopSpeaking(); return }
    if (voice.paused || voice.mic === 'off' || voice.mic === 'error') {
      void voice.resume()
      if (R.current.step === 'home') goStep('menu', true, `${t(greeting())} `)
      else say(PROMPT[R.current.step] ? t(PROMPT[R.current.step]) : "I'm listening again. How can I help?")
    } else {
      voice.pause()
      setCaption(t('Paused. I won’t listen or speak until you tap the mic again.'))
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
            <div translate="no" className="whitespace-nowrap text-lg font-bold text-slate-900">MedLens</div>
            <div className="hidden text-xs text-slate-500 sm:block">{t('Your voice health assistant')}</div>
          </div>
        </button>
        <span className="mr-auto" />
        <LanguageSwitch />
        <span className={`chip ${llm ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${llm ? 'animate-pulse bg-emerald-500' : 'bg-rose-500'}`} /><span className="hidden sm:inline">{t(llm ? 'Ready' : health ? 'Assistant not set up' : 'Server offline')}</span>
        </span>
        <button className="btn-ghost !px-2 !py-1.5" title="Sign out" onClick={() => { auth.set(null); voice.stop(); setDoctor(null) }}><LogOut size={14} /></button>
      </header>

      <main className="relative z-10 mx-auto grid max-w-7xl gap-6 px-5 pb-10 lg:grid-cols-[360px_1fr]">
        {/* ---------- voice column ---------- */}
        <section className="order-2 lg:order-none lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-3xl border border-white/60 bg-white/75 p-6 shadow-xl backdrop-blur">
            <VoiceOrb mode={mode} analyser={voice.analyserRef} disabled={!llm} onClick={onOrb} />
            <div className="mt-4 min-h-[96px] text-center">
              <AnimatePresence mode="wait">
                {heard && <motion.p key={'h' + heard} initial={{ opacity: 0 }} animate={{ opacity: 1 }} translate="no" className="mb-2 text-sm italic text-slate-400">“{heard}”</motion.p>}
              </AnimatePresence>
              <AnimatePresence mode="wait">
                <motion.p key={caption || 'empty'} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="text-[15px] leading-relaxed text-slate-700">
                  {caption || (llm ? t('Tap the mic and just talk. I can guide you through every step by voice.') : 'Add GROQ_API_KEY to backend/.env to enable the assistant.')}
                </motion.p>
              </AnimatePresence>
              {voice.error && <p className="mt-2 text-xs text-rose-600">{voice.error}</p>}
            </div>
            {llm && (
              <div className="mt-3">
                <div className="mb-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">{t('Try saying')}</div>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {TRY[step].map(p => <button key={p} onClick={() => onUtterance(t(p), false)} className="rounded-full bg-brand-50 px-3 py-1 text-xs text-brand-700 transition hover:bg-brand-100">“{t(p)}”</button>)}
                </div>
              </div>
            )}
            <form className="mt-4 flex gap-2" onSubmit={e => { e.preventDefault(); if (text.trim()) { onUtterance(text.trim(), false); setText('') } }}>
              <input className="input !rounded-full !px-4" placeholder={t('…or type here')} value={text} onChange={e => setText(e.target.value)} disabled={!llm} />
              <button className="btn-primary !rounded-full !px-3" disabled={!llm || !text.trim()} aria-label="Send"><Send size={16} /></button>
            </form>
          </div>
        </section>

        {/* ---------- guided stage ---------- */}
        <section className="order-1 min-w-0 space-y-5 lg:order-none">
          {step !== 'home' && (
            <motion.nav initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-wrap items-center gap-2 text-sm">
              <button className="btn-ghost !rounded-full !py-1.5" onClick={back}><ArrowLeft size={14} />{t('Back')}</button>
              <button className="flex items-center gap-1 text-slate-400 hover:text-slate-700" onClick={() => goStep('home', false)}><Home size={14} /></button>
              {TRAIL[step].map((crumb, i) => (
                <span key={crumb} className="flex items-center gap-2 text-slate-400"><ChevronRight size={14} />
                  <span className={i === TRAIL[step].length - 1 ? 'font-semibold text-slate-700' : ''}>{t(crumb)}</span></span>
              ))}
              {area && <span className="chip ml-auto bg-brand-100 text-brand-800">{t('Area: {part}', { part: t(BODY_PART_LABELS[area]) })}
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
                  {t("Hi, I'm")} <span className="bg-gradient-to-r from-brand-600 to-violet-600 bg-clip-text text-transparent" translate="no">MedLens</span>
                </motion.h1>
                <p className="mb-4 mt-1 text-center text-sm text-slate-500">{t('Tap any part of the body to start, or just talk to me.')}</p>
                <BodyHero selected={area} onSelect={begin} />
              </motion.div>
            )}

            {step === 'menu' && (
              <motion.div key="menu" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <VoiceStage mode={mode} heard={heard} question={t(PROMPT.menu)}>
                  <BodyHero selected={area} onSelect={p => p && setArea(p)} compact />
                </VoiceStage>
              </motion.div>
            )}

            {step === 'report' && (
              <motion.div key="report" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <VoiceStage mode={mode} heard={heard} question={t(PROMPT.report)}>
                  <BodyHero selected={area} onSelect={p => p && setArea(p)} compact />
                </VoiceStage>
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
                          <div className="text-lg font-semibold text-slate-800">{t('Drop your medical report here')}</div>
                          <div className="mt-1 text-sm text-slate-500">{t('or click to browse · PDF, image, Word or text')}</div>
                        </>
                      )}
                    </motion.div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="flex items-center gap-3 rounded-2xl bg-white/80 p-4 text-sm text-slate-600 shadow-sm">
                        <Mic className="shrink-0 text-brand-600" size={20} /><span>{t("Or say “open the CBC report from Downloads” and I'll find it for you.")}</span>
                      </div>
                      <button onClick={() => openCamera()} className="flex items-center gap-3 rounded-2xl bg-white/80 p-4 text-left text-sm text-slate-600 shadow-sm transition hover:bg-white">
                        <Camera className="shrink-0 text-amber-600" size={20} /><span>{t('Paper report? Use the camera instead.')}</span>
                      </button>
                    </div>
                  </>
                )}
                {result?.kind === 'report' && (
                  <Panel k={'r' + result.doc.id}>
                    <ReportResult doc={result.doc} analysis={result.analysis} stage={result.stage} onReadAloud={readAloud} onDownload={askDownload} downloading={downloading} />
                    {result.stage === 'done' && <div className="mt-4 flex justify-center"><button className="btn-ghost" onClick={() => setResult(null)}><RotateCcw size={14} />{t('Analyze another report')}</button></div>}
                  </Panel>
                )}
                {result?.kind === 'files' && !result.photo && filesPanel(result)}
              </motion.div>
            )}

            {step === 'image' && (
              <motion.div key="image" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                {result?.kind !== 'image' ? (
                  <>
                    <motion.h2 initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-bold text-slate-900">{t('Show me the problem')}</motion.h2>
                    <ImageIntake area={area} busy={false} captured={captured} onClearCaptured={() => setCaptured(null)}
                      onCamera={() => openCamera(true, 'image')} onAnalyze={(b, _n, notes) => void runImage(b, notes)} />
                    {result?.kind === 'files' && result.photo && filesPanel(result)}
                  </>
                ) : (
                  <>
                    <Panel k={'img' + result.preview}><ImageDiagnosisView data={result.data} busy={!result.data} preview={result.preview} onReadAloud={readAloud} /></Panel>
                    {result.data && <div className="flex justify-center"><button className="btn-ghost" onClick={() => setResult(null)}><RotateCcw size={14} />{t('Check another photo')}</button></div>}
                  </>
                )}
              </motion.div>
            )}

            {step === 'disease' && (
              <motion.div key="disease" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                {(!result || result.kind === 'report' || result.kind === 'files') ? (
                  <>
                    <motion.h2 initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-bold text-slate-900">{t("What's bothering you?")}</motion.h2>
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
                    {!resultBusy && <div className="flex justify-center"><button className="btn-ghost" onClick={() => setResult(null)}><RotateCcw size={14} />{t('Ask something else')}</button></div>}
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
