import { motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, HeartPulse, Lightbulb, ShieldCheck, Siren, XCircle, type LucideIcon } from 'lucide-react'
import type { Severity } from '../types'

type Tone = 'do' | 'avoid' | 'prevent' | 'info' | 'alert' | 'life'

const TONE: Record<Tone, { box: string; icon: string; Icon: LucideIcon; bullet: LucideIcon }> = {
  do: { box: 'border-emerald-200 bg-emerald-50/70', icon: 'text-emerald-600', Icon: CheckCircle2, bullet: CheckCircle2 },
  avoid: { box: 'border-rose-200 bg-rose-50/70', icon: 'text-rose-600', Icon: XCircle, bullet: XCircle },
  prevent: { box: 'border-violet-200 bg-violet-50/70', icon: 'text-violet-600', Icon: ShieldCheck, bullet: ShieldCheck },
  info: { box: 'border-sky-200 bg-sky-50/70', icon: 'text-sky-600', Icon: Lightbulb, bullet: Lightbulb },
  alert: { box: 'border-amber-200 bg-amber-50/80', icon: 'text-amber-600', Icon: Siren, bullet: AlertTriangle },
  life: { box: 'border-teal-200 bg-teal-50/70', icon: 'text-teal-600', Icon: HeartPulse, bullet: HeartPulse },
}

/** A titled, animated list of short tips. */
export function TipCard({ title, items, tone, delay = 0 }: { title: string; items?: string[]; tone: Tone; delay?: number }) {
  if (!items?.length) return null
  const t = TONE[tone]
  return (
    <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.35 }}
      whileHover={{ y: -3 }} className={`rounded-2xl border p-4 shadow-sm transition-shadow hover:shadow-md ${t.box}`}>
      <h3 className="mb-2.5 flex items-center gap-2 text-sm font-bold text-slate-800">
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg bg-white shadow-sm ${t.icon}`}><t.Icon size={16} /></span>
        {title}
      </h3>
      <ul className="space-y-1.5">
        {items.map((x, i) => (
          <motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: delay + 0.08 + i * 0.06 }}
            className="flex items-start gap-2 text-sm leading-snug text-slate-700">
            <t.bullet size={14} className={`mt-0.5 shrink-0 ${t.icon}`} />{x}
          </motion.li>
        ))}
      </ul>
    </motion.section>
  )
}

export function CareGrid({ precautions, avoid, prevention, lifestyle, seeDoctor, causes }: {
  precautions?: string[]; avoid?: string[]; prevention?: string[]; lifestyle?: string[]; seeDoctor?: string[]; causes?: string[]
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <TipCard title="Common causes" items={causes} tone="info" delay={0} />
      <TipCard title="Precautions to take" items={precautions} tone="do" delay={0.05} />
      <TipCard title="Things to avoid" items={avoid} tone="avoid" delay={0.1} />
      <TipCard title="Prevention" items={prevention} tone="prevent" delay={0.15} />
      <TipCard title="Healthy habits" items={lifestyle} tone="life" delay={0.2} />
      <TipCard title="See a doctor quickly if" items={seeDoctor} tone="alert" delay={0.25} />
    </div>
  )
}

const LEVELS: { key: Severity; label: string; color: string }[] = [
  { key: 'normal', label: 'Normal', color: 'bg-emerald-500' },
  { key: 'mild', label: 'Mild', color: 'bg-lime-500' },
  { key: 'moderate', label: 'Moderate', color: 'bg-amber-500' },
  { key: 'serious', label: 'Serious', color: 'bg-rose-500' },
]

/** Four-step animated meter showing how complex / urgent the picture looks. */
export function SeverityMeter({ level, reason, title = 'How serious is it?' }: { level?: Severity; reason?: string; title?: string }) {
  if (!level) return null
  const idx = Math.max(0, LEVELS.findIndex(l => l.key === level))
  const cur = level === 'varies' ? { label: 'Varies', color: 'bg-slate-400' } : LEVELS[idx]
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</span>
        <span className={`chip text-white ${cur.color}`}>{cur.label}</span>
      </div>
      <div className="flex gap-1.5">
        {LEVELS.map((l, i) => (
          <div key={l.key} className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <motion.div className={`h-full ${l.color}`} initial={{ width: 0 }}
              animate={{ width: level !== 'varies' && i <= idx ? '100%' : '0%' }} transition={{ delay: 0.15 + i * 0.18, duration: 0.35 }} />
          </div>
        ))}
      </div>
      {reason && <p className="mt-2 text-sm text-slate-600">{reason}</p>}
    </motion.div>
  )
}

/** Short bullet takeaways, each in its own animated pill. */
export function KeyPoints({ items, title = 'Key points' }: { items?: string[]; title?: string }) {
  if (!items?.length) return null
  return (
    <section>
      <h3 className="mb-2 text-sm font-bold text-slate-800">{title}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((x, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}
            className="flex items-start gap-2.5 rounded-xl border border-brand-100 bg-white p-3 text-sm text-slate-700 shadow-sm">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{i + 1}</span>
            {x}
          </motion.div>
        ))}
      </div>
    </section>
  )
}
