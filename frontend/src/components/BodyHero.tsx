import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Hand } from 'lucide-react'
import { BODY_PART_LABELS, FRONT, ORGAN_COLOR, type Shape } from './AnatomyViewer'
import { useLang } from '../i18n'

interface Props {
  selected: string | null
  onSelect: (part: string | null) => void
  compact?: boolean
}

/** Large animated anatomy figure for the home screen: scan line, beating heart, glowing hover. */
export default function BodyHero({ selected, onSelect, compact }: Props) {
  const [hover, setHover] = useState<string | null>(null)
  const { t } = useLang()
  const label = hover || selected

  const render = (s: Shape, i: number) => {
    const active = selected === s.id
    const hot = hover === s.id
    const base = ORGAN_COLOR[s.id] || '#ddd'
    const isSkin = s.id === 'skin'
    const props = {
      ...s.p,
      fill: s.stroke ? 'none' : active ? '#14b8c6' : base,
      fillOpacity: isSkin ? 0.85 : s.id === 'chest' ? 0.3 : 1,
      stroke: s.stroke ? (active ? '#14b8c6' : base) : active || hot ? '#0f5c66' : 'rgba(0,0,0,0.15)',
      strokeWidth: s.stroke ? (s.p.strokeWidth as number) : active || hot ? 2 : 0.7,
      style: { cursor: 'pointer', transition: 'all .2s', filter: active || hot ? 'drop-shadow(0 0 6px #14b8c6)' : undefined },
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); onSelect(isSkin ? null : s.id) },
      onMouseEnter: () => setHover(isSkin ? null : s.id),
      onMouseLeave: () => setHover(null),
      role: 'button',
      'aria-label': t(BODY_PART_LABELS[s.id]),
    }
    const key = `${s.id}-${i}`
    if (s.id === 'heart') {
      return (
        <motion.path key={key} {...props} d={s.p.d as string}
          style={{ ...props.style, transformBox: 'fill-box', transformOrigin: 'center' }}
          animate={{ scale: [1, 1.12, 1, 1.08, 1] }} transition={{ duration: 1.1, repeat: Infinity, repeatDelay: 0.4 }} />
      )
    }
    if (s.id === 'lungs') {
      return (
        <motion.path key={key} {...props} d={s.p.d as string}
          style={{ ...props.style, transformBox: 'fill-box', transformOrigin: 'center' }}
          animate={{ scale: [1, 1.04, 1] }} transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }} />
      )
    }
    if (s.el === 'ellipse') return <ellipse key={key} {...props} />
    if (s.el === 'rect') return <rect key={key} {...props} />
    if (s.el === 'circle') return <circle key={key} {...props} />
    return <path key={key} {...props} />
  }

  return (
    <div className="relative flex flex-col items-center">
      {/* halo */}
      <motion.div className="pointer-events-none absolute top-[18%] h-72 w-72 rounded-full bg-brand-300/30 blur-3xl"
        animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.8, 0.5] }} transition={{ duration: 5, repeat: Infinity }} />
      <div className="relative">
        <motion.svg viewBox="40 8 220 600" className={`relative block w-auto ${compact ? 'h-[300px]' : 'h-[min(62vh,560px)]'}`}
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <defs>
            <linearGradient id="scan" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#14b8c6" stopOpacity="0" />
              <stop offset="0.5" stopColor="#14b8c6" stopOpacity="0.55" />
              <stop offset="1" stopColor="#14b8c6" stopOpacity="0" />
            </linearGradient>
          </defs>
          {FRONT.map(render)}
          {/* scanning beam */}
          <motion.rect x="40" width="220" height="40" fill="url(#scan)" pointerEvents="none"
            animate={{ y: [0, 570, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }} />
        </motion.svg>
        {/* floating particles */}
        {[...Array(6)].map((_, i) => (
          <motion.span key={i} className="pointer-events-none absolute h-1.5 w-1.5 rounded-full bg-brand-400/60"
            style={{ left: `${10 + i * 15}%`, top: `${20 + (i % 3) * 25}%` }}
            animate={{ y: [0, -18, 0], opacity: [0.2, 0.9, 0.2] }} transition={{ duration: 3 + i * 0.4, repeat: Infinity, delay: i * 0.3 }} />
        ))}
        <AnimatePresence>
          {label && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-900/85 px-3 py-1 text-xs font-medium text-white shadow">
              {t(BODY_PART_LABELS[label])}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {!compact && (
        <motion.div className="mt-2 flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-sm text-slate-600 shadow-sm backdrop-blur"
          animate={{ y: [0, -3, 0] }} transition={{ duration: 2.2, repeat: Infinity }}>
          <Hand size={16} className="text-brand-600" /> {t('Tap the body or say “Hey, I need help” to begin')}
        </motion.div>
      )}
    </div>
  )
}
