import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Mic, MicOff, Volume2, VolumeX, Loader2, Send, AlertTriangle } from 'lucide-react'
import type { MicState } from '../hooks/useVoice'

export interface ChatMsg { role: 'user' | 'assistant' | 'system'; content: string; uncertain?: boolean }

interface Props {
  mic: MicState
  paused?: boolean
  speaking: boolean
  error: string | null
  analyser: React.RefObject<AnalyserNode | null>
  messages: ChatMsg[]
  thinking: boolean
  llmReady: boolean
  onToggleMic: () => void
  onStopSpeaking: () => void
  onSend: (text: string) => void
}

function Waveform({ analyser, active }: { analyser: React.RefObject<AnalyserNode | null>; active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let raf = 0
    const c = ref.current!
    const g = c.getContext('2d')!
    const data = new Uint8Array(512)
    const draw = () => {
      const w = (c.width = c.clientWidth * devicePixelRatio)
      const h = (c.height = c.clientHeight * devicePixelRatio)
      g.clearRect(0, 0, w, h)
      const a = analyser.current
      const bars = 40
      if (a && active) a.getByteTimeDomainData(data)
      for (let i = 0; i < bars; i++) {
        let amp = 0.04
        if (a && active) {
          const seg = data.slice(Math.floor((i / bars) * data.length), Math.floor(((i + 1) / bars) * data.length))
          amp = Math.max(0.04, Math.max(...seg.map(v => Math.abs(v - 128) / 128)) * 1.6)
        }
        const bh = Math.min(h, amp * h)
        const bw = (w / bars) * 0.55
        g.fillStyle = active ? '#1a929e' : '#cbd5e1'
        g.beginPath()
        g.roundRect(i * (w / bars) + bw * 0.4, (h - bh) / 2, bw, bh, bw / 2)
        g.fill()
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [analyser, active])
  return <canvas ref={ref} className="h-12 w-full" />
}

const STATUS: Record<MicState, string> = {
  off: 'Microphone off', starting: 'Requesting microphone…', listening: 'Listening — speak any time',
  recording: 'Hearing you…', processing: 'Recognising speech…', error: 'Microphone unavailable',
}

export default function VoiceAssistant(p: Props) {
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const on = p.mic !== 'off' && p.mic !== 'error'
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }) }, [p.messages, p.thinking])

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">Voice Assistant</h2>
        <p className="text-xs text-slate-500">Groq Whisper speech recognition · spoken replies</p>
      </div>

      <div className="flex flex-col items-center gap-2 px-4 pt-4">
        <div className="relative">
          {p.mic === 'recording' && (
            <motion.span className="absolute inset-0 rounded-full bg-brand-400/40" animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
              transition={{ repeat: Infinity, duration: 1.2 }} />
          )}
          {p.mic === 'listening' && (
            <motion.span className="absolute inset-0 rounded-full bg-brand-200/60" animate={{ scale: [1, 1.25, 1] }}
              transition={{ repeat: Infinity, duration: 2.2 }} />
          )}
          <button onClick={p.onToggleMic} disabled={!p.llmReady}
            title={p.llmReady ? (on ? 'Pause the assistant' : 'Resume the assistant') : 'Backend GROQ_API_KEY missing'}
            className={`relative flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg transition disabled:opacity-40 ${on ? 'bg-brand-600 hover:bg-brand-700' : 'bg-slate-500 hover:bg-slate-600'}`}>
            {p.mic === 'processing' || p.mic === 'starting' ? <Loader2 className="animate-spin" /> : on ? <Mic size={26} /> : <MicOff size={26} />}
          </button>
        </div>
        <div className={`text-xs font-medium ${p.mic === 'error' ? 'text-rose-600' : 'text-slate-600'}`}>{p.paused ? 'Paused — not listening. Tap the mic to resume' : STATUS[p.mic]}</div>
        <Waveform analyser={p.analyser} active={on} />
        <div className="flex h-8 items-center gap-2">
          {p.speaking ? (
            <>
              <motion.div className="flex items-center gap-1 text-xs text-brand-700" animate={{ opacity: [1, 0.5, 1] }} transition={{ repeat: Infinity, duration: 1.2 }}>
                <Volume2 size={15} /> AI speaking
              </motion.div>
              <button className="btn-ghost !py-1 !text-xs" onClick={p.onStopSpeaking}><VolumeX size={14} /> Stop speaking</button>
            </>
          ) : p.thinking ? <span className="flex items-center gap-1 text-xs text-slate-500"><Loader2 size={13} className="animate-spin" /> Thinking…</span> : null}
        </div>
        {p.error && <div className="flex w-full items-start gap-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-700"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{p.error}</div>}
        {!p.llmReady && <div className="w-full rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Voice and AI features need <code>GROQ_API_KEY</code> in <code>backend/.env</code>.</div>}
      </div>

      <div ref={listRef} className="mt-3 flex-1 space-y-2 overflow-y-auto scroll-thin px-4 pb-3">
        {p.messages.map((m, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm ${m.role === 'user' ? 'ml-auto bg-brand-600 text-white' : m.role === 'system' ? 'mx-auto bg-slate-100 text-xs text-slate-500' : 'bg-slate-100 text-slate-800'}`}>
            {m.content}
            {m.uncertain && <div className="mt-1 text-[11px] opacity-80">⚠ low recognition confidence</div>}
          </motion.div>
        ))}
      </div>

      <form className="flex gap-2 border-t border-slate-100 p-3" onSubmit={e => { e.preventDefault(); if (text.trim()) { p.onSend(text.trim()); setText('') } }}>
        <input className="input" placeholder='Type a command, e.g. "Investigate the lungs"' value={text} onChange={e => setText(e.target.value)} disabled={!p.llmReady} />
        <button className="btn-primary !px-3" disabled={!p.llmReady || !text.trim()}><Send size={16} /></button>
      </form>
    </div>
  )
}
