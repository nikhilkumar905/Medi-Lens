import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../services/api'

export type MicState = 'off' | 'starting' | 'listening' | 'recording' | 'processing' | 'error'

interface Options {
  onUtterance: (text: string, uncertain: boolean) => void
  language?: string
}

/**
 * Hands-free voice loop:
 *  mic -> energy-based voice activity detection -> MediaRecorder segment
 *  -> Groq Whisper transcription (backend) -> onUtterance
 * Spoken replies use the browser's SpeechSynthesis. Talking while the assistant
 * speaks interrupts it (barge-in).
 */
export function useVoice({ onUtterance, language }: Options) {
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

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const speakTokenRef = useRef(0)
  const serverTtsRef = useRef(true) // disabled for the session after the first failure

  const stopSpeaking = useCallback(() => {
    speakTokenRef.current++
    window.speechSynthesis?.cancel()
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    speakingRef.current = false
    setSpeaking(false)
  }, [])

  const browserSpeak = useCallback((clean: string, token: number) => {
    if (!('speechSynthesis' in window) || token !== speakTokenRef.current) return
    const u = new SpeechSynthesisUtterance(clean)
    u.rate = 1.03
    if (language) u.lang = language
    const voices = window.speechSynthesis.getVoices()
    const preferred = voices.find(v => /en-(US|GB|IN)/.test(v.lang) && /Natural|Neural|Online/i.test(v.name)) ||
      voices.find(v => /en-(US|GB|IN)/.test(v.lang) && /Google/i.test(v.name)) || voices.find(v => v.lang.startsWith('en'))
    if (preferred && !language) u.voice = preferred
    u.onstart = () => { speakingRef.current = true; setSpeaking(true) }
    u.onend = u.onerror = () => { if (token === speakTokenRef.current) { speakingRef.current = false; setSpeaking(false) } }
    window.speechSynthesis.speak(u)
  }, [language])

  /** Natural Groq TTS, sentence by sentence (next chunk prefetched); browser voice as fallback. */
  const speak = useCallback(async (text: string) => {
    if (!text?.trim()) return
    lastSpokenRef.current = text
    stopSpeaking()
    const token = speakTokenRef.current
    const clean = text.replace(/\[E\d+\]/g, '').replace(/[*#_`]/g, '').trim()
    if (!serverTtsRef.current) return browserSpeak(clean, token)
    const chunks: string[] = []
    for (const sent of clean.match(/[^.!?]+[.!?]*\s*/g) || [clean]) {
      const last = chunks[chunks.length - 1]
      if (last && last.length + sent.length < 220) chunks[chunks.length - 1] = last + sent
      else chunks.push(sent)
    }
    speakingRef.current = true
    setSpeaking(true)
    try {
      let next = api.speak(chunks[0].trim())
      for (let i = 0; i < chunks.length; i++) {
        const blob = await next
        if (token !== speakTokenRef.current) return
        if (i + 1 < chunks.length) next = api.speak(chunks[i + 1].trim())
        const url = URL.createObjectURL(blob)
        await new Promise<void>((resolve) => {
          const a = new Audio(url)
          audioRef.current = a
          a.onended = a.onerror = a.onpause = () => resolve()
          a.play().catch(() => resolve())
        })
        URL.revokeObjectURL(url)
        if (token !== speakTokenRef.current) return
      }
      speakingRef.current = false
      setSpeaking(false)
    } catch {
      if (token !== speakTokenRef.current) return
      serverTtsRef.current = false // e.g. TTS model terms not accepted yet
      browserSpeak(clean, token)
    }
  }, [stopSpeaking, browserSpeak])

  const repeat = useCallback(() => { if (lastSpokenRef.current) speak(lastSpokenRef.current) }, [speak])

  const stop = useCallback(() => {
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
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
        const dur = performance.now() - recStart
        if (dur < 500 || blob.size < 2000) { busyRef.current = false; if (streamRef.current) setMic('listening'); return }
        setMic('processing')
        try {
          const r = await api.transcribe(blob)
          if (r.text.trim()) cbRef.current(r.text.trim(), r.uncertain)
        } catch (e) {
          setError((e as Error).message)
        } finally {
          busyRef.current = false
          if (streamRef.current) setMic('listening')
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

  useEffect(() => () => { stop(); window.speechSynthesis?.cancel() }, [stop])

  return { mic, speaking, error, setError, start, stop, speak, stopSpeaking, repeat, analyserRef, lastSpoken: lastSpokenRef }
}
