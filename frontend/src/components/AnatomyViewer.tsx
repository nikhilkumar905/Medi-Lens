import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { RotateCcw, ZoomIn, ZoomOut, Repeat2 } from 'lucide-react'

export const BODY_PART_LABELS: Record<string, string> = {
  brain: 'Brain', eyes: 'Eyes', ears: 'Ears', nose: 'Nose', mouth: 'Mouth', jaw: 'Jaw', skull: 'Skull',
  neck: 'Neck', heart: 'Heart', lungs: 'Lungs', chest: 'Chest', shoulders: 'Shoulders', liver: 'Liver',
  stomach: 'Stomach', pancreas: 'Pancreas', kidneys: 'Kidneys', gallbladder: 'Gallbladder', spleen: 'Spleen',
  small_intestine: 'Small intestine', large_intestine: 'Large intestine', pelvis: 'Pelvis', bladder: 'Bladder',
  reproductive: 'Reproductive organs', spine: 'Spine', ribs: 'Ribs', arms: 'Arms', legs: 'Legs', knees: 'Knees',
  feet: 'Feet', skin: 'Skin',
}

export const REGION_GROUP: Record<string, string> = {
  brain: 'Head', eyes: 'Head', ears: 'Head', nose: 'Head', mouth: 'Head', jaw: 'Head', skull: 'Skeleton',
  neck: 'Upper body', heart: 'Upper body', lungs: 'Upper body', chest: 'Upper body', shoulders: 'Upper body',
  liver: 'Abdomen', stomach: 'Abdomen', pancreas: 'Abdomen', kidneys: 'Abdomen', gallbladder: 'Abdomen',
  spleen: 'Abdomen', small_intestine: 'Abdomen', large_intestine: 'Abdomen', pelvis: 'Skeleton', bladder: 'Lower body',
  reproductive: 'Lower body', spine: 'Skeleton', ribs: 'Skeleton', arms: 'Skeleton', legs: 'Lower body',
  knees: 'Lower body', feet: 'Lower body', skin: 'Skin',
}

const ORGAN_COLOR: Record<string, string> = {
  brain: '#f4a6b8', eyes: '#7cc4e8', ears: '#f3c19b', nose: '#f3c19b', mouth: '#e57373', jaw: '#e8d9c0',
  neck: '#f1c9a5', heart: '#e53950', lungs: '#f48fa3', chest: '#fde2d3', shoulders: '#e8d9c0', liver: '#9c4a3c',
  stomach: '#f0a875', pancreas: '#f6d28b', kidneys: '#b5525d', gallbladder: '#7fb069', spleen: '#8e4a6e',
  small_intestine: '#f5b9a0', large_intestine: '#d9967a', pelvis: '#e8d9c0', bladder: '#f6d36b',
  reproductive: '#d8a1c4', spine: '#e8d9c0', ribs: '#e8d9c0', skull: '#e8d9c0', arms: '#f1c9a5', legs: '#f1c9a5',
  knees: '#e8d9c0', feet: '#f1c9a5', skin: '#f6d5bd',
}

type Shape = { id: string; el: 'ellipse' | 'path' | 'rect' | 'circle'; p: Record<string, string | number>; stroke?: boolean }

const mirror = (d: string) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => `${300 - Number(x)} ${y}`)
const ARM = 'M 86 138 C 70 146 64 176 62 214 L 54 296 C 50 318 48 338 50 358 L 64 360 C 66 340 70 320 75 298 L 88 228 Z'
const LEG = 'M 100 352 L 148 352 L 146 462 L 142 576 L 118 576 L 112 462 Z'

const SILHOUETTE: Shape[] = [
  { id: 'skin', el: 'path', p: { d: 'M 150 118 C 120 118 94 122 86 138 L 82 200 C 84 240 100 270 104 300 C 100 320 96 336 98 352 L 202 352 C 204 336 200 320 196 300 C 200 270 216 240 218 200 L 214 138 C 206 122 180 118 150 118 Z' } },
  { id: 'arms', el: 'path', p: { d: ARM } },
  { id: 'arms', el: 'path', p: { d: mirror(ARM) } },
  { id: 'arms', el: 'circle', p: { cx: 56, cy: 370, r: 10 } },
  { id: 'arms', el: 'circle', p: { cx: 244, cy: 370, r: 10 } },
  { id: 'legs', el: 'path', p: { d: LEG } },
  { id: 'legs', el: 'path', p: { d: mirror(LEG) } },
  { id: 'feet', el: 'ellipse', p: { cx: 128, cy: 586, rx: 19, ry: 9 } },
  { id: 'feet', el: 'ellipse', p: { cx: 172, cy: 586, rx: 19, ry: 9 } },
  { id: 'knees', el: 'ellipse', p: { cx: 129, cy: 462, rx: 15, ry: 11 } },
  { id: 'knees', el: 'ellipse', p: { cx: 171, cy: 462, rx: 15, ry: 11 } },
  { id: 'neck', el: 'rect', p: { x: 136, y: 98, width: 28, height: 24, rx: 6 } },
  { id: 'skin', el: 'ellipse', p: { cx: 150, cy: 58, rx: 36, ry: 44 } },
]

const FRONT: Shape[] = [
  ...SILHOUETTE,
  { id: 'brain', el: 'path', p: { d: 'M 124 50 C 122 30 136 18 150 18 C 166 18 180 30 176 50 C 170 44 160 46 150 44 C 140 46 130 44 124 50 Z' } },
  { id: 'eyes', el: 'ellipse', p: { cx: 137, cy: 62, rx: 6, ry: 4 } },
  { id: 'eyes', el: 'ellipse', p: { cx: 163, cy: 62, rx: 6, ry: 4 } },
  { id: 'ears', el: 'ellipse', p: { cx: 113, cy: 64, rx: 5, ry: 10 } },
  { id: 'ears', el: 'ellipse', p: { cx: 187, cy: 64, rx: 5, ry: 10 } },
  { id: 'nose', el: 'path', p: { d: 'M 150 64 L 144 80 L 156 80 Z' } },
  { id: 'mouth', el: 'ellipse', p: { cx: 150, cy: 88, rx: 10, ry: 3.5 } },
  { id: 'jaw', el: 'path', p: { d: 'M 124 84 C 130 100 140 104 150 104 C 160 104 170 100 176 84 L 172 84 C 166 96 158 99 150 99 C 142 99 134 96 128 84 Z' } },
  { id: 'shoulders', el: 'ellipse', p: { cx: 96, cy: 138, rx: 14, ry: 9 } },
  { id: 'shoulders', el: 'ellipse', p: { cx: 204, cy: 138, rx: 14, ry: 9 } },
  { id: 'chest', el: 'rect', p: { x: 104, y: 134, width: 92, height: 88, rx: 22 } },
  { id: 'lungs', el: 'path', p: { d: 'M 146 150 C 128 146 110 160 108 190 C 106 212 112 222 128 222 C 140 222 146 214 146 200 Z' } },
  { id: 'lungs', el: 'path', p: { d: 'M 154 150 C 172 146 190 160 192 190 C 194 212 188 222 172 222 C 160 222 154 214 154 200 Z' } },
  { id: 'heart', el: 'path', p: { d: 'M 157 180 C 150 170 138 176 142 188 C 145 198 157 206 160 210 C 164 204 174 196 176 188 C 178 176 166 170 157 180 Z' } },
  { id: 'liver', el: 'path', p: { d: 'M 104 228 C 110 220 150 220 162 228 C 160 240 146 252 120 250 C 108 248 102 240 104 228 Z' } },
  { id: 'gallbladder', el: 'ellipse', p: { cx: 140, cy: 252, rx: 6, ry: 5 } },
  { id: 'stomach', el: 'path', p: { d: 'M 166 226 C 182 222 192 232 190 246 C 188 258 176 262 166 258 C 160 254 164 246 160 240 C 158 234 160 228 166 226 Z' } },
  { id: 'spleen', el: 'ellipse', p: { cx: 200, cy: 236, rx: 6, ry: 12 } },
  { id: 'pancreas', el: 'path', p: { d: 'M 136 262 C 150 256 170 256 186 260 C 184 266 168 268 152 268 C 144 268 136 266 136 262 Z' } },
  { id: 'kidneys', el: 'ellipse', p: { cx: 122, cy: 272, rx: 8, ry: 13 } },
  { id: 'kidneys', el: 'ellipse', p: { cx: 178, cy: 272, rx: 8, ry: 13 } },
  { id: 'large_intestine', el: 'path', stroke: true, p: { d: 'M 120 330 L 118 284 C 118 278 124 276 130 276 L 170 276 C 176 276 182 278 182 284 L 182 330', fill: 'none', strokeWidth: 9, strokeLinecap: 'round' } },
  { id: 'small_intestine', el: 'ellipse', p: { cx: 150, cy: 306, rx: 24, ry: 20 } },
  { id: 'pelvis', el: 'path', p: { d: 'M 108 330 C 116 346 130 350 140 346 L 150 356 L 160 346 C 170 350 184 346 192 330 L 186 342 C 178 360 122 360 114 342 Z' } },
  { id: 'bladder', el: 'ellipse', p: { cx: 150, cy: 340, rx: 12, ry: 8 } },
  { id: 'reproductive', el: 'ellipse', p: { cx: 150, cy: 360, rx: 8, ry: 6 } },
]

const BACK: Shape[] = [
  ...SILHOUETTE,
  { id: 'skull', el: 'ellipse', p: { cx: 150, cy: 54, rx: 31, ry: 38 } },
  { id: 'brain', el: 'ellipse', p: { cx: 150, cy: 48, rx: 24, ry: 26 } },
  { id: 'shoulders', el: 'path', p: { d: 'M 104 142 L 136 148 L 132 186 L 112 178 Z' } },
  { id: 'shoulders', el: 'path', p: { d: 'M 196 142 L 164 148 L 168 186 L 188 178 Z' } },
  ...[150, 164, 178, 192, 206, 220].map((y, i) => ({ id: 'ribs', el: 'path' as const, stroke: true,
    p: { d: `M 146 ${y} C ${126 - i} ${y - 4} ${112 - i} ${y + 4} ${110 - i} ${y + 14} M 154 ${y} C ${174 + i} ${y - 4} ${188 + i} ${y + 4} ${190 + i} ${y + 14}`, fill: 'none', strokeWidth: 4, strokeLinecap: 'round' } })),
  { id: 'kidneys', el: 'ellipse', p: { cx: 128, cy: 262, rx: 9, ry: 14 } },
  { id: 'kidneys', el: 'ellipse', p: { cx: 172, cy: 262, rx: 9, ry: 14 } },
  { id: 'spine', el: 'path', p: { d: Array.from({ length: 18 }, (_, i) => `M 144 ${104 + i * 13} h 12 v 9 h -12 Z`).join(' ') } },
  { id: 'pelvis', el: 'path', p: { d: 'M 110 320 C 118 346 136 352 150 348 C 164 352 182 346 190 320 C 182 330 166 334 150 330 C 134 334 118 330 110 320 Z' } },
]

interface Props { selected: string | null; onSelect: (part: string) => void }

export default function AnatomyViewer({ selected, onSelect }: Props) {
  const [view, setView] = useState<'front' | 'back'>('front')
  const [zoom, setZoom] = useState(1)
  const [hover, setHover] = useState<string | null>(null)
  const shapes = view === 'front' ? FRONT : BACK
  const label = hover || selected

  const render = (s: Shape, i: number) => {
    const active = selected === s.id
    const isHover = hover === s.id
    const base = ORGAN_COLOR[s.id] || '#ddd'
    const isSkin = s.id === 'skin'
    const key = `${s.id}-${i}`
    const props = {
      ...s.p,
      fill: s.stroke ? 'none' : active ? '#14b8c6' : base,
      fillOpacity: isSkin ? (active ? 0.55 : 0.9) : s.id === 'chest' ? (active ? 0.6 : 0.35) : 1,
      stroke: s.stroke ? (active ? '#14b8c6' : base) : active ? '#0f5c66' : isHover ? '#0f5c66' : 'rgba(0,0,0,0.18)',
      strokeWidth: s.stroke ? (s.p.strokeWidth as number) : active || isHover ? 2 : 0.8,
      style: { cursor: 'pointer', transition: 'all .2s', filter: active ? 'drop-shadow(0 0 6px #14b8c6)' : undefined },
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); onSelect(s.id) },
      onMouseEnter: () => setHover(s.id),
      onMouseLeave: () => setHover(null),
      role: 'button',
      'aria-label': BODY_PART_LABELS[s.id],
    }
    if (s.el === 'ellipse') return <ellipse key={key} {...props} />
    if (s.el === 'rect') return <rect key={key} {...props} />
    if (s.el === 'circle') return <circle key={key} {...props} />
    return <path key={key} {...props} />
  }

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-3">
        <div className="min-w-0">
          <h2 className="whitespace-nowrap text-sm font-semibold text-slate-900">Anatomy</h2>
          <p className="truncate text-[11px] text-slate-500">Click or say a part</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button className="btn-ghost !px-2 !py-1.5" title="Zoom out" onClick={() => setZoom(z => Math.max(0.8, z - 0.2))}><ZoomOut size={15} /></button>
          <button className="btn-ghost !px-2 !py-1.5" title="Zoom in" onClick={() => setZoom(z => Math.min(2.4, z + 0.2))}><ZoomIn size={15} /></button>
          <button className="btn-ghost !px-2 !py-1.5" title="Reset" onClick={() => setZoom(1)}><RotateCcw size={15} /></button>
          <button className="btn-ghost !px-2 !py-1.5" title="Rotate front/back" onClick={() => setView(v => (v === 'front' ? 'back' : 'front'))}>
            <Repeat2 size={15} /><span className="text-[11px]">{view === 'front' ? 'Front' : 'Back'}</span>
          </button>
        </div>
      </div>
      <div className="relative flex-1 overflow-auto scroll-thin bg-gradient-to-b from-brand-50 to-white"
        onWheel={e => { if (e.ctrlKey) { e.preventDefault(); setZoom(z => Math.min(2.4, Math.max(0.8, z - e.deltaY * 0.002))) } }}>
        <AnimatePresence mode="wait">
          <motion.svg key={view} viewBox="40 8 220 600" className="mx-auto block h-full max-h-[640px] w-auto"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center top' }}
            initial={{ rotateY: 90, opacity: 0 }} animate={{ rotateY: 0, opacity: 1 }} exit={{ rotateY: -90, opacity: 0 }}
            transition={{ duration: 0.35 }}>
            {shapes.map(render)}
          </motion.svg>
        </AnimatePresence>
        <AnimatePresence>
          {label && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="pointer-events-none absolute left-3 top-3 rounded-lg bg-slate-900/85 px-3 py-1.5 text-xs text-white shadow">
              <span className="font-semibold">{BODY_PART_LABELS[label]}</span>
              <span className="ml-2 text-slate-300">{REGION_GROUP[label]}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="border-t border-slate-100 px-3 py-2">
        <select className="input !py-1.5" value={selected || ''} onChange={e => e.target.value && onSelect(e.target.value)}>
          <option value="">Select a region…</option>
          {['Head', 'Upper body', 'Abdomen', 'Lower body', 'Skeleton', 'Skin'].map(g => (
            <optgroup key={g} label={g}>
              {Object.keys(BODY_PART_LABELS).filter(k => REGION_GROUP[k] === g).map(k => <option key={k} value={k}>{BODY_PART_LABELS[k]}</option>)}
            </optgroup>
          ))}
        </select>
        <p className="mt-1.5 text-[11px] text-slate-400">Selecting a region opens an investigation workflow — it is not a diagnosis.</p>
      </div>
    </div>
  )
}
