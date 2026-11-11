import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../services/api'

export type MicState = 'off' | 'starting' | 'listening' | 'recording' | 'processing' | 'error'

const PREROLL_S = 0.6

/** Mono PCM chunks → 16-bit WAV, resampled to `outRate` (Whisper's native 16 kHz). */
function encodeWav(chunks: Float32Array[], inRate: number, outRate: number): Blob {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const pcm = new Float32Array(total)
  let o = 0
  for (const c of chunks) { pcm.set(c, o); o += c.length }
  const ratio = inRate / outRate
  const n = Math.floor(total / ratio)
  const out = new DataView(new ArrayBuffer(44 + n * 2))
  const str = (p: number, t: string) => { for (let i = 0; i < t.length; i++) out.setUint8(p + i, t.charCodeAt(i)) }
  str(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ')
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true)
  out.setUint32(24, outRate, true); out.setUint32(28, outRate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true)
  str(36, 'data'); out.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    // average the input samples that fall into this output sample (simple low-pass + decimate)
    const a = Math.floor(i * ratio), b = Math.min(total, Math.floor((i + 1) * ratio))
    let acc = 0
    for (let j = a; j < b; j++) acc += pcm[j]
    const v = Math.max(-1, Math.min(1, acc / Math.max(1, b - a)))
    out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true)
  }
  return new Blob([out.buffer], { type: 'audio/wav' })
}

/**
 * True when a transcript is the assistant's own voice picked up by the microphone: at least 3 words, and most of
 * them belong to runs of 3+ consecutive words copied from what the assistant said. A user's short answer
 * ("one", "analyze my report") reuses single words of the question but not whole phrases, so it is kept.
 */
function isEcho(heard: string, spoken: string): boolean {
  const words = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  const h = words(heard)
  const s = words(spoken)
  if (h.length < 3 || s.length < 3) return false
  const tri = new Set(s.slice(0, -2).map((w, i) => `${w} ${s[i + 1]} ${s[i + 2]}`))
  const inRun = new Array<boolean>(h.length).fill(false)
  for (let i = 0; i + 2 < h.length; i++) {
    if (tri.has(`${h[i]} ${h[i + 1]} ${h[i + 2]}`)) inRun[i] = inRun[i + 1] = inRun[i + 2] = true
  }
  return inRun.filter(Boolean).length / h.length >= 0.6
}

const PAUSE_KEY = 'medlens_voice_paused'
let cachedVoice: SpeechSynthesisVoice | null | undefined

/** Pick the assistant's voice once (waiting for the browser's voice list to load) and reuse it everywhere. */
function assistantVoice(language?: string): Promise<SpeechSynthesisVoice | null> {
  if (cachedVoice !== undefined && !language) return Promise.resolve(cachedVoice)
  const choose = (voices: SpeechSynthesisVoice[]) => {
    if (language) return voices.find(v => v.lang.toLowerCase().startsWith(language.toLowerCase())) || null
    const en = voices.filter(v => /^en[-_](US|GB|IN)/i.test(v.lang))
    return en.find(v => /Natural|Neural|Online/i.test(v.name)) || en.find(v => /Google/i.test(v.name)) ||
      en.find(v => v.default) || en[0] || voices.find(v => v.lang.startsWith('en')) || voices[0] || null
  }
  return new Promise(resolve => {
    const done = (v: SpeechSynthesisVoice | null) => { if (!language) cachedVoice = v; resolve(v) }
    const now = window.speechSynthesis.getVoices()
    if (now.length) return done(choose(now))
    const t = setTimeout(() => done(choose(window.speechSynthesis.getVoices())), 1500)
    window.speechSynthesis.addEventListener('voiceschanged', () => { clearTimeout(t); done(choose(window.speechSynthesis.getVoices())) }, { once: true })
  })
}

interface Options {
  onUtterance: (text: string, uncertain: boolean) => void
  /** BCP-47 voice for spoken replies, e.g. "hi-IN" (omit for English) */
  language?: string
  /** Whisper language for speech recognition: "en" | "hi" | "te" */
  sttLanguage?: string
}

/**
 * Hands-free voice loop:
 *  mic -> energy-based voice activity detection (with a 0.6 s pre-roll so word starts are kept)
 *  -> 16 kHz WAV -> Groq Whisper transcription (backend) -> echo filter -> onUtterance
 * Spoken replies use the browser's SpeechSynthesis. Talking while the assistant
 * speaks interrupts it (barge-in).
 */
export function useVoice({ onUtterance, language, sttLanguage }: Options) {
  const sttRef = useRef(sttLanguage)
  sttRef.current = sttLanguage
  const [mic, setMic] = useState<MicState>('off')
  const [speaking, setSpeaking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const procRef = useRef<ScriptProcessorNode | null>(null)
  const capturingRef = useRef(false)
  const speakEndRef = useRef(0)
  const rafRef = useRef<number>(0)
  const busyRef = useRef(false)
  const speakingRef = useRef(false)
  const lastSpokenRef = useRef('')
  const cbRef = useRef(onUtterance)
  cbRef.current = onUtterance

  const speakTokenRef = useRef(0)
  // Paused = the assistant neither listens nor speaks until the user resumes. Remembered across reloads/views.
  const [paused, setPausedState] = useState<boolean>(() => { try { return localStorage.getItem(PAUSE_KEY) === '1' } catch { return false } })
  const pausedRef = useRef(paused)
  // Bumped on every start/stop: audio recorded or transcribed in an older session is thrown away.
  const sessionRef = useRef(0)
  const setPaused = (v: boolean) => {
    pausedRef.current = v
    setPausedState(v)
    try { localStorage.setItem(PAUSE_KEY, v ? '1' : '0') } catch { /* storage unavailable */ }
  }

  const stopSpeaking = useCallback(() => {
    speakTokenRef.current++
    window.speechSynthesis?.cancel()
    if (speakingRef.current) speakEndRef.current = performance.now()
    speakingRef.current = false
    setSpeaking(false)
  }, [])

  /**
   * ONE voice for the whole app: the browser's speech engine with a single voice chosen once
   * (cached module-wide, so every screen and every reply sounds the same). Text is spoken
   * sentence by sentence through one queue; starting a new reply always cancels the old one,
   * so two voices can never overlap.
   */
  const speak = useCallback(async (text: string, speakLang?: string) => {
    if (!text?.trim() || !('speechSynthesis' in window) || pausedRef.current) return
    lastSpokenRef.current = text
    stopSpeaking()
    const token = speakTokenRef.current
    const clean = text.replace(/\[E\d+\]/g, '').replace(/[*#_`]/g, '').replace(/\s+/g, ' ').trim()
    const lang = speakLang && !speakLang.startsWith('en') ? speakLang : language
    const voice = await assistantVoice(lang)
    if (token !== speakTokenRef.current) return
    // Chrome stops long utterances after ~15 s, so queue short sentence groups.
    const chunks: string[] = []
    for (const sent of clean.match(/[^.!?]+[.!?]*\s*/g) || [clean]) {
      const last = chunks[chunks.length - 1]
      if (last && last.length + sent.length < 200) chunks[chunks.length - 1] = last + sent
      else chunks.push(sent)
    }
    speakingRef.current = true
    setSpeaking(true)
    chunks.forEach((c, i) => {
      const u = new SpeechSynthesisUtterance(c.trim())
      if (voice) { u.voice = voice; u.lang = voice.lang } else if (lang) u.lang = lang
      u.rate = 1.02
      u.pitch = 1
      if (i === chunks.length - 1) {
        u.onend = u.onerror = () => { if (token === speakTokenRef.current) { speakingRef.current = false; speakEndRef.current = performance.now(); setSpeaking(false) } }
      }
      window.speechSynthesis.speak(u)
    })
  }, [stopSpeaking, language])

  const repeat = useCallback(() => { if (lastSpokenRef.current) speak(lastSpokenRef.current) }, [speak])

  // Watchdog: Chrome sometimes never fires the "end" event of an utterance. Without this the app would stay in
  // "speaking" mode forever, and the microphone would only react to very loud, long speech.
  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    let idle = 0
    const t = setInterval(() => {
      const busy = window.speechSynthesis.speaking || window.speechSynthesis.pending
      idle = speakingRef.current && !busy ? idle + 1 : 0
      if (idle >= 2) {
        idle = 0
        speakingRef.current = false
        speakEndRef.current = performance.now()
        setSpeaking(false)
      }
    }, 300)
    return () => clearInterval(t)
  }, [])

  const stop = useCallback(() => {
    sessionRef.current++ // discard anything still being recorded or transcribed
    busyRef.current = false
    capturingRef.current = false
    cancelAnimationFrame(rafRef.current)
    procRef.current?.disconnect()
    procRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    ctxRef.current?.close().catch(() => {})
    streamRef.current = null
    ctxRef.current = null
    analyserRef.current = null
    setMic('off')
  }, [])

  const start = useCallback(async () => {
    if (streamRef.current) return
    const session = ++sessionRef.current
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser does not support microphone access. Use a recent Chrome, Edge or Firefox over http://localhost or HTTPS.')
      setMic('error')
      return
    }
    setMic('starting')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
    } catch (e) {
      const name = (e as DOMException).name
      setError(name === 'NotAllowedError'
        ? 'Microphone permission was denied. Click the lock icon in the address bar and allow the microphone, then try again.'
        : name === 'NotFoundError' ? 'No microphone was found. Connect a microphone and try again.' : `Microphone error: ${(e as Error).message}`)
      setMic('error')
      return
    }
    if (session !== sessionRef.current || pausedRef.current) { stream.getTracks().forEach(t => t.stop()); setMic('off'); return }
    streamRef.current = stream
    stream.getAudioTracks()[0].addEventListener('ended', () => {
      setError('Microphone disconnected.')
      stop()
      setMic('error')
    })
    const ctx = new AudioContext()
    ctxRef.current = ctx
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
    const src = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    src.connect(analyser)
    analyserRef.current = analyser

    // Raw PCM capture with a rolling pre-roll buffer. Voice detection needs a moment to trigger, and soft
    // first sounds ("f" in "file") are quieter than the threshold, so we keep the last PREROLL_S seconds and
    // prepend them: the start of every word is preserved.
    const rate = ctx.sampleRate
    const prerollMax = Math.round(rate * PREROLL_S)
    let preroll: Float32Array[] = []
    let prerollLen = 0
    let captured: Float32Array[] = []
    const proc = ctx.createScriptProcessor(2048, 1, 1)
    proc.onaudioprocess = e => {
      const data = new Float32Array(e.inputBuffer.getChannelData(0))
      if (capturingRef.current) { captured.push(data); return }
      preroll.push(data)
      prerollLen += data.length
      while (prerollLen - preroll[0].length > prerollMax) prerollLen -= preroll.shift()!.length
    }
    const mute = ctx.createGain()
    mute.gain.value = 0 // the processor must be connected to run, but nothing should be audible
    src.connect(proc)
    proc.connect(mute)
    mute.connect(ctx.destination)
    procRef.current = proc
    setMic('listening')

    const buf = new Float32Array(analyser.fftSize)
    let floor = 0.01
    let voiceMs = 0
    let silenceMs = 0
    let recStart = 0
    let last = performance.now()
    let startedDuringSpeech = false

    const beginCapture = (duringSpeech: boolean) => {
      startedDuringSpeech = duringSpeech
      captured = [...preroll]
      preroll = []
      prerollLen = 0
      capturingRef.current = true
      recStart = performance.now()
      setMic('recording')
    }

    const endCapture = async () => {
      capturingRef.current = false
      const chunks = captured
      captured = []
      const voicedMs = performance.now() - recStart
      if (session !== sessionRef.current || pausedRef.current) { busyRef.current = false; return }
      if (voicedMs < 250) { busyRef.current = false; if (streamRef.current) setMic('listening'); return }
      setMic('processing')
      try {
        const wav = encodeWav(chunks, rate, 16000)
        const r = await api.transcribe(wav, sttRef.current)
        const text = r.text.trim()
        // a recording that began while the assistant was talking may be its own voice from the speakers
        if (text && startedDuringSpeech && isEcho(text, lastSpokenRef.current)) return
        if (text && session === sessionRef.current && !pausedRef.current) cbRef.current(text, r.uncertain)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        if (session === sessionRef.current) {
          busyRef.current = false
          if (streamRef.current) setMic('listening')
        }
      }
    }

    const tick = () => {
      const now = performance.now()
      const dt = now - last
      last = now
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const rms = Math.sqrt(sum / buf.length)
      // While the assistant talks (or just finished), require somewhat louder speech to interrupt, so its own
      // voice from the speakers rarely triggers a recording. Still short enough for a one-word answer like "one";
      // echoes that do get recorded are filtered out by isEcho().
      const echoRisk = speakingRef.current || now - speakEndRef.current < 400
      const threshold = echoRisk ? Math.max(0.05, floor * 5) : Math.max(0.015, floor * 2.6)
      const voiced = rms > threshold

      if (!capturingRef.current && !busyRef.current) {
        if (!voiced) floor = floor * 0.98 + rms * 0.02
        voiceMs = voiced ? voiceMs + dt : Math.max(0, voiceMs - dt / 2)
        if (voiceMs > (echoRisk ? 160 : 110)) {
          if (speakingRef.current) stopSpeaking() // barge-in
          busyRef.current = true
          voiceMs = 0
          silenceMs = 0
          beginCapture(echoRisk)
        }
      } else if (capturingRef.current) {
        const keepTalking = rms > Math.max(0.012, floor * 2)
        silenceMs = keepTalking ? 0 : silenceMs + dt
        if (silenceMs > 900 || now - recStart > 15000) void endCapture()
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [stop, stopSpeaking])

  /** User pressed pause: stop listening AND speaking; nothing is heard or said until resume(). */
  const pause = useCallback(() => {
    setPaused(true)
    stopSpeaking()
    stop()
  }, [stop, stopSpeaking])

  /** User pressed resume: start listening again. */
  const resume = useCallback(async () => {
    setPaused(false)
    await start()
  }, [start])

  /** Automatic mic start (e.g. after tapping the body). Does nothing while the user has paused. */
  const startIfAllowed = useCallback(async () => {
    if (!pausedRef.current) await start()
  }, [start])

  useEffect(() => () => { stop(); window.speechSynthesis?.cancel() }, [stop])

  return { mic, speaking, paused, error, setError, start, stop, pause, resume, startIfAllowed, speak, stopSpeaking, repeat, analyserRef, lastSpoken: lastSpokenRef }
}
