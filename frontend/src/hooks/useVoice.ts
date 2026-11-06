import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../services/api'

export type MicState = 'off' | 'starting' | 'listening' | 'recording' | 'processing' | 'error'

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
 *  mic -> energy-based voice activity detection -> MediaRecorder segment
 *  -> Groq Whisper transcription (backend) -> onUtterance
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
  const recRef = useRef<MediaRecorder | null>(null)
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
        u.onend = u.onerror = () => { if (token === speakTokenRef.current) { speakingRef.current = false; setSpeaking(false) } }
      }
      window.speechSynthesis.speak(u)
    })
  }, [stopSpeaking, language])

  const repeat = useCallback(() => { if (lastSpokenRef.current) speak(lastSpokenRef.current) }, [speak])

  const stop = useCallback(() => {
    sessionRef.current++ // discard anything still being recorded or transcribed
    busyRef.current = false
    cancelAnimationFrame(rafRef.current)
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop()
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
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
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
    const src = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 1024
    src.connect(analyser)
    analyserRef.current = analyser
    setMic('listening')

    const buf = new Float32Array(analyser.fftSize)
    let floor = 0.01
    let voiceMs = 0
    let silenceMs = 0
    let recStart = 0
    let last = performance.now()
    let chunks: Blob[] = []

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : ''

    const beginRecording = () => {
      chunks = []
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      rec.ondataavailable = e => e.data.size && chunks.push(e.data)
      rec.onstop = async () => {
        if (session !== sessionRef.current || pausedRef.current) { busyRef.current = false; return }
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
        const dur = performance.now() - recStart
        if (dur < 500 || blob.size < 2000) { busyRef.current = false; if (streamRef.current) setMic('listening'); return }
        setMic('processing')
        try {
          const r = await api.transcribe(blob, sttRef.current)
          if (r.text.trim() && session === sessionRef.current && !pausedRef.current) cbRef.current(r.text.trim(), r.uncertain)
        } catch (e) {
          setError((e as Error).message)
        } finally {
          if (session === sessionRef.current) {
            busyRef.current = false
            if (streamRef.current) setMic('listening')
          }
        }
      }
      rec.start(250)
      recRef.current = rec
      recStart = performance.now()
      setMic('recording')
    }

    const tick = () => {
      const now = performance.now()
      const dt = now - last
      last = now
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      const rms = Math.sqrt(sum / buf.length)
      const threshold = speakingRef.current ? Math.max(0.06, floor * 6) : Math.max(0.018, floor * 3)
      const voiced = rms > threshold
      const rec = recRef.current
      const recording = rec && rec.state === 'recording'

      if (!recording && !busyRef.current) {
        if (!voiced) floor = floor * 0.98 + rms * 0.02
        voiceMs = voiced ? voiceMs + dt : Math.max(0, voiceMs - dt)
        if (voiceMs > 160) {
          if (speakingRef.current) stopSpeaking() // barge-in
          busyRef.current = true
          voiceMs = 0
          silenceMs = 0
          beginRecording()
        }
      } else if (recording) {
        silenceMs = voiced ? 0 : silenceMs + dt
        if (silenceMs > 1100 || now - recStart > 15000) rec!.stop()
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
