import { useLang } from '../i18n'
import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Brain, Stethoscope, Square } from 'lucide-react'
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
  const { t } = useLang()
  const coreRef = useRef<HTMLDivElement>(null)
  const iconRef = useRef<HTMLSpanElement>(null)
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
      iconRef.current?.style.setProperty('--lvl', String(level))
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
          onClick={onClick} disabled={disabled} aria-label={t(LABEL[mode])}
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
          <span ref={iconRef} className="relative flex items-center justify-center">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={iconKey(mode)} className="flex items-center justify-center"
                initial={{ opacity: 0, scale: 0.6, rotate: -20 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} exit={{ opacity: 0, scale: 0.6, rotate: 20 }}
                transition={{ duration: 0.22 }}>
                <StateIcon mode={mode} />
              </motion.span>
            </AnimatePresence>
          </span>
        </motion.button>
      </div>
      <motion.div key={mode} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
        className={`flex items-center gap-1.5 text-sm font-medium ${mode === 'error' ? 'text-rose-600' : mode === 'paused' ? 'rounded-full bg-slate-200 px-3 py-1 text-slate-700' : 'text-slate-600'}`}>
        {mode === 'speaking' && <Square size={12} className="fill-current" />}
        {t(LABEL[mode])}
      </motion.div>
    </div>
  )
}

const iconKey = (m: OrbMode) => (m === 'speaking' ? 'ecg' : m === 'thinking' ? 'brain' : m === 'paused' || m === 'error' ? 'muted' : 'steth')

/** Medical icon set for the voice orb: stethoscope = listening, ECG heartbeat = speaking, crossed stethoscope = muted. */
function StateIcon({ mode }: { mode: OrbMode }) {
  if (mode === 'speaking') return <EcgIcon />
  if (mode === 'thinking') return (
    <motion.span animate={{ scale: [1, 1.1, 1], opacity: [0.85, 1, 0.85] }} transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}>
      <Brain size={58} strokeWidth={1.6} />
    </motion.span>
  )
  if (mode === 'paused' || mode === 'error') return <MutedStethoscope />
  return <ListeningStethoscope active={mode === 'listening' || mode === 'hearing'} hearing={mode === 'hearing'} />
}

/** Stethoscope that "breathes" while waiting and bounces with the user's voice (--lvl is the live mic level). */
function ListeningStethoscope({ active, hearing }: { active: boolean; hearing: boolean }) {
  return (
    <span className="relative flex h-20 w-20 items-center justify-center">
      {active && [0, 1].map(i => (
        <motion.span key={i} className="absolute bottom-1 right-0 h-6 w-6 rounded-full border-2 border-white/70"
          initial={{ scale: 0.4, opacity: 0.9 }} animate={{ scale: hearing ? 2.1 : 1.6, opacity: 0 }}
          transition={{ duration: hearing ? 0.8 : 1.8, repeat: Infinity, delay: i * (hearing ? 0.4 : 0.9), ease: 'easeOut' }} />
      ))}
      {/* outer span follows the live voice level; inner span carries the idle animation (framer owns its transform) */}
      <span style={{ display: 'flex', transform: 'scale(calc(1 + var(--lvl, 0) * 0.28))', transition: 'transform 80ms linear' }}>
        <motion.span style={{ display: 'flex' }}
          animate={active ? { rotate: [0, -4, 4, 0] } : { scale: [1, 1.05, 1] }}
          transition={{ duration: active ? (hearing ? 0.6 : 2.4) : 3, repeat: Infinity, ease: 'easeInOut' }}>
          <Stethoscope size={62} strokeWidth={1.7} />
        </motion.span>
      </span>
    </span>
  )
}

/** Stethoscope with a slash: the assistant is muted / not listening. */
function MutedStethoscope() {
  return (
    <span className="relative flex h-20 w-20 items-center justify-center opacity-85">
      <Stethoscope size={60} strokeWidth={1.6} />
      <svg viewBox="0 0 64 64" className="absolute inset-0 h-20 w-20" fill="none" aria-hidden>
        <motion.line x1="10" y1="10" x2="54" y2="54" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, ease: 'easeOut' }} />
      </svg>
    </span>
  )
}

/** ECG heartbeat trace that draws itself across the orb while the assistant speaks. */
function EcgIcon() {
  const d = 'M2 34 H16 L20 28 L24 34 H28 L32 12 L37 52 L42 22 L45 34 H52 L55 30 L58 34 H70'
  return (
    <svg viewBox="0 0 72 64" className="h-20 w-[92px]" fill="none" aria-hidden>
      <path d={d} stroke="white" strokeOpacity="0.25" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <motion.path d={d} stroke="white" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"
        initial={{ pathLength: 0, pathOffset: 0 }} animate={{ pathLength: [0, 0.45, 0.45, 0], pathOffset: [0, 0.2, 0.55, 1] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'linear', times: [0, 0.3, 0.7, 1] }} />
      <motion.circle r="3.2" fill="white" style={{ filter: 'drop-shadow(0 0 4px #fff)' }}
        animate={{ cx: [2, 16, 20, 24, 28, 32, 37, 42, 45, 52, 55, 58, 70], cy: [34, 34, 28, 34, 34, 12, 52, 22, 34, 34, 30, 34, 34] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }} />
    </svg>
  )
}
