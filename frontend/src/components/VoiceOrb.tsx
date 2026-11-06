import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, Loader2, Square } from 'lucide-react'
import type { MicState } from '../hooks/useVoice'

export type OrbMode = 'off' | 'paused' | 'listening' | 'hearing' | 'thinking' | 'speaking' | 'error'

interface Props {
  mode: OrbMode
  analyser: React.RefObject<AnalyserNode | null>
  disabled?: boolean
  onClick: () => void
}

export function orbMode(mic: MicState, speaking: boolean, thinking: boolean, paused = false): OrbMode {
  if (paused) return 'paused'
  if (speaking) return 'speaking'
  if (thinking || mic === 'processing' || mic === 'starting') return 'thinking'
  if (mic === 'recording') return 'hearing'
  if (mic === 'listening') return 'listening'
  if (mic === 'error') return 'error'
  return 'off'
}

const LABEL: Record<OrbMode, string> = {
  off: 'Tap to talk', paused: 'Paused: not listening. Tap to resume', listening: "I'm listening…", hearing: 'Hearing you…', thinking: 'Thinking…',
  speaking: 'Speaking — tap to stop', error: 'Microphone unavailable — tap to retry',
}

/** Big animated speak button. Its glow follows the live microphone level. */
export default function VoiceOrb({ mode, analyser, disabled, onClick }: Props) {
  const coreRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const buf = new Uint8Array(256)
    const tick = () => {
      const a = analyser.current
      let level = 0
      if (a && (mode === 'listening' || mode === 'hearing')) {
        a.getByteTimeDomainData(buf)
        let peak = 0
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128))
        level = Math.min(1, peak / 60)
      }
      coreRef.current?.style.setProperty('--lvl', String(level))
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [analyser, mode])

  const active = mode !== 'off' && mode !== 'error' && mode !== 'paused'
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative flex h-56 w-56 items-center justify-center">
        {/* expanding rings while listening / speaking */}
        <AnimatePresence>
          {(mode === 'listening' || mode === 'hearing' || mode === 'speaking') && [0, 1, 2].map(i => (
            <motion.span key={`${mode}-${i}`} className={`absolute inset-6 rounded-full ${mode === 'speaking' ? 'bg-violet-400/30' : 'bg-brand-400/30'}`}
              initial={{ scale: 0.8, opacity: 0.6 }} animate={{ scale: mode === 'hearing' ? 1.7 : 1.45, opacity: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: mode === 'hearing' ? 1.1 : 2.4, repeat: Infinity, delay: i * (mode === 'hearing' ? 0.35 : 0.8), ease: 'easeOut' }} />
          ))}
        </AnimatePresence>
        {/* spinning ring while thinking */}
        {mode === 'thinking' && (
          <motion.span className="absolute inset-3 rounded-full"
            style={{ background: 'conic-gradient(from 0deg, transparent 0 55%, #3fb0bb 75%, #8b5cf6 100%)', WebkitMask: 'radial-gradient(circle, transparent 62%, #000 63%)', mask: 'radial-gradient(circle, transparent 62%, #000 63%)' }}
            animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }} />
        )}
        <motion.button
          onClick={onClick} disabled={disabled} aria-label={LABEL[mode]}
          whileHover={{ scale: disabled ? 1 : 1.04 }} whileTap={{ scale: 0.95 }}
          animate={mode === 'off' ? { scale: [1, 1.035, 1] } : { scale: 1 }}
          transition={mode === 'off' ? { duration: 3, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
          className="relative z-10 flex h-36 w-36 items-center justify-center rounded-full text-white shadow-2xl outline-none focus-visible:ring-4 focus-visible:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <div ref={coreRef} className="absolute inset-0 rounded-full transition-[box-shadow] duration-75"
            style={{
              background: mode === 'paused' ? 'radial-gradient(circle at 30% 30%, #cbd5e1, #64748b 60%, #334155)'
                : mode === 'speaking' ? 'radial-gradient(circle at 30% 30%, #a78bfa, #7c3aed 55%, #4c1d95)'
                : mode === 'error' ? 'radial-gradient(circle at 30% 30%, #fda4af, #e11d48 60%, #881337)'
                  : active ? 'radial-gradient(circle at 30% 30%, #5eead4, #1a929e 55%, #0a3a40)'
                    : 'radial-gradient(circle at 30% 30%, #67c6cf, #137582 60%, #0a3a40)',
              boxShadow: '0 0 calc(20px + var(--lvl, 0) * 70px) calc(var(--lvl, 0) * 18px) rgba(63,176,187,.55)',
              transform: 'scale(calc(1 + var(--lvl, 0) * 0.08))',
            }} />
          <span className="relative">
            {mode === 'thinking' ? <Loader2 size={44} className="animate-spin" />
              : mode === 'speaking' ? <SpeakingBars />
                : mode === 'off' || mode === 'error' || mode === 'paused' ? (mode === 'off' ? <Mic size={46} /> : <MicOff size={44} />)
                  : <Mic size={46} />}
          </span>
        </motion.button>
      </div>
      <motion.div key={mode} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
        className={`flex items-center gap-1.5 text-sm font-medium ${mode === 'error' ? 'text-rose-600' : mode === 'paused' ? 'rounded-full bg-slate-200 px-3 py-1 text-slate-700' : 'text-slate-600'}`}>
        {mode === 'speaking' && <Square size={12} className="fill-current" />}
        {LABEL[mode]}
      </motion.div>
    </div>
  )
}

function SpeakingBars() {
  return (
    <span className="flex h-12 items-center gap-1.5">
      {[0, 1, 2, 3, 4].map(i => (
        <motion.span key={i} className="w-2 rounded-full bg-white"
          animate={{ height: [10, 38, 16, 30, 10] }} transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.12, ease: 'easeInOut' }} />
      ))}
    </span>
  )
}
