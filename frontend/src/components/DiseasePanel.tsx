import { useState } from 'react'
import { motion } from 'framer-motion'
import { Activity, BookOpen, Loader2, Microscope, Search, Sparkles, Stethoscope, Users } from 'lucide-react'
import type { DiseaseInfo } from '../types'
import { CareGrid, SeverityMeter, TipCard } from './CareCards'
import { EvidenceList } from './AnalysisPanel'
import { BODY_PART_LABELS } from './AnatomyViewer'

const SYMPTOMS = ['Fever', 'Cough', 'Headache', 'Tiredness', 'Sore throat', 'Body pain', 'Joint pain', 'Chest pain',
  'Breathlessness', 'Stomach pain', 'Nausea', 'Vomiting', 'Diarrhoea', 'Rash', 'Dizziness', 'Weight loss']
const DURATIONS = ['Today', '2–3 days', 'About a week', 'Over a month']
const DISEASES = ['Diabetes', 'High blood pressure', 'Dengue', 'Anemia', 'Thyroid disorder', 'Asthma', 'Migraine', 'Typhoid']

interface IntakeProps {
  area: string | null
  busy: boolean
  onSymptoms: (text: string) => void
  onDisease: (name: string) => void
}

/** Input side of option 2: pick symptoms (or describe them), or name a disease to learn about. */
export function DiseaseIntake({ area, busy, onSymptoms, onDisease }: IntakeProps) {
  const [picked, setPicked] = useState<string[]>([])
  const [dur, setDur] = useState<string | null>(null)
  const [age, setAge] = useState('')
  const [extra, setExtra] = useState('')
  const [disease, setDisease] = useState('')
  const toggle = (s: string) => setPicked(p => (p.includes(s) ? p.filter(x => x !== s) : [...p, s]))
  const canCheck = picked.length > 0 || extra.trim().length > 2

  const submit = () => {
    const parts = [
      picked.length ? `Symptoms: ${picked.join(', ')}` : '',
      extra.trim(),
      dur ? `for ${dur.toLowerCase()}` : '',
      age ? `age ${age}` : '',
      area ? `problem area: ${BODY_PART_LABELS[area] || area}` : '',
    ].filter(Boolean)
    onSymptoms(parts.join('. '))
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-white/60 bg-white/85 p-5 shadow-lg backdrop-blur">
        <h3 className="flex items-center gap-2 font-bold text-slate-900"><Stethoscope size={18} className="text-brand-600" />Check symptoms</h3>
        <p className="mb-3 mt-0.5 text-sm text-slate-500">Tap what you feel, or just say it, e.g. “fever and headache for three days”.</p>
        {area && <div className="mb-3"><span className="chip bg-brand-100 text-brand-800">Area: {BODY_PART_LABELS[area]}</span></div>}
        <div className="flex flex-wrap gap-1.5">
          {SYMPTOMS.map((s, i) => {
            const on = picked.includes(s)
            return (
              <motion.button key={s} initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.02 }}
                whileTap={{ scale: 0.92 }} onClick={() => toggle(s)}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${on ? 'border-brand-600 bg-brand-600 text-white shadow' : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300'}`}>
                {s}
              </motion.button>
            )
          })}
        </div>
        <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">Since when?</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {DURATIONS.map(d => (
            <button key={d} onClick={() => setDur(x => (x === d ? null : d))}
              className={`rounded-full px-3 py-1 text-sm transition ${dur === d ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{d}</button>
          ))}
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-[90px_1fr]">
          <input className="input" placeholder="Age" value={age} onChange={e => setAge(e.target.value.replace(/[^\d]/g, '').slice(0, 3))} inputMode="numeric" />
          <input className="input" placeholder="Anything else? e.g. worse at night, recent travel" value={extra} onChange={e => setExtra(e.target.value)} />
        </div>
        <button className="btn-primary mt-4 w-full !py-2.5" disabled={!canCheck || busy} onClick={submit}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}Predict possible conditions
        </button>
      </motion.section>

      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
        className="rounded-3xl border border-white/60 bg-white/85 p-5 shadow-lg backdrop-blur">
        <h3 className="flex items-center gap-2 font-bold text-slate-900"><BookOpen size={18} className="text-violet-600" />Learn about a disease</h3>
        <p className="mb-3 mt-0.5 text-sm text-slate-500">Causes, prevention, precautions and what to avoid. Or say “tell me about dengue”.</p>
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (disease.trim().length > 1) onDisease(disease.trim()) }}>
          <input className="input" placeholder="e.g. Diabetes" value={disease} onChange={e => setDisease(e.target.value)} />
          <button className="btn-primary !px-3" disabled={busy || disease.trim().length < 2} aria-label="Search"><Search size={16} /></button>
        </form>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {DISEASES.map(d => (
            <button key={d} onClick={() => onDisease(d)} disabled={busy}
              className="rounded-full bg-violet-50 px-3 py-1 text-sm text-violet-700 transition hover:bg-violet-100">{d}</button>
          ))}
        </div>
      </motion.section>
    </div>
  )
}

/** Friendly card view of one disease. */
export function DiseaseView({ data, busy, name }: { data: DiseaseInfo | null; busy: boolean; name: string }) {
  if (busy || !data) return (
    <div className="flex flex-col items-center gap-3 py-14 text-slate-500">
      <motion.div animate={{ rotate: 360 }} transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}><Microscope className="text-violet-600" size={34} /></motion.div>
      <p className="text-sm">Looking up {name}…</p>
    </div>
  )
  return (
    <div className="space-y-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 to-brand-600 p-5 text-white shadow-md">
        <motion.div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/10" animate={{ scale: [1, 1.25, 1] }} transition={{ duration: 4, repeat: Infinity }} />
        <div className="text-xs font-semibold uppercase tracking-wider opacity-80">About</div>
        <h2 className="text-xl font-bold">{data.name}</h2>
        <p className="relative mt-1.5 text-[15px] leading-relaxed">{data.overview}</p>
      </motion.div>
      <SeverityMeter level={data.severity} title="Typical seriousness" />
      <div className="grid gap-3 md:grid-cols-2">
        <TipCard title="Common symptoms" items={data.symptoms} tone="info" />
        <TipCard title="Who is at risk" items={data.risk_factors} tone="life" delay={0.05} />
      </div>
      <CareGrid causes={data.causes} prevention={data.prevention} precautions={data.precautions} avoid={data.avoid} seeDoctor={data.see_doctor_if} />
      <TipCard title="How it's diagnosed" items={data.diagnostic_tests} tone="info" delay={0.3} />
      {data.warnings.map((w, i) => <div key={i} className="text-xs text-amber-700">⚠ {w}</div>)}
      {!!data.evidence.length && (
        <details className="rounded-2xl border border-slate-200 bg-white p-4">
          <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-slate-700"><Users size={15} />Research sources ({data.evidence.length})</summary>
          <div className="mt-3"><EvidenceList evidence={data.evidence} /></div>
        </details>
      )}
      <p className="flex items-center justify-center gap-1 text-center text-[11px] text-slate-400"><Activity size={11} />{data.limitations.join(' ')}</p>
    </div>
  )
}
