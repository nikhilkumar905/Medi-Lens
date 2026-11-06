import { motion } from 'framer-motion'
import { AlertOctagon, BookOpen, ClipboardList, HelpCircle, Loader2, MessageCircleQuestion, Stethoscope } from 'lucide-react'
import type { SymptomResult } from '../types'
import { EvidenceList } from './AnalysisPanel'
import { CareGrid, SeverityMeter } from './CareCards'
import { TranslatingNote, useLang, useTranslated } from '../i18n'

export const LIKELIHOOD_STYLE: Record<string, string> = {
  'more likely': 'bg-rose-100 text-rose-700 border-rose-200',
  possible: 'bg-amber-100 text-amber-800 border-amber-200',
  'less likely': 'bg-slate-100 text-slate-600 border-slate-200',
}

export function ConditionCards({ items }: { items: { condition: string; likelihood?: string; reasoning?: string; rationale?: string; evidence: string[] }[] }) {
  const { t } = useLang()
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {items.map((c, i) => (
        <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
          className={`rounded-xl border p-3 ${LIKELIHOOD_STYLE[c.likelihood || 'possible']?.split(' ').filter(x => x.startsWith('border')).join(' ')} bg-white`}>
          <div className="flex items-start justify-between gap-2">
            <div className="font-semibold text-slate-900">{c.condition}</div>
            <span className={`chip shrink-0 ${LIKELIHOOD_STYLE[c.likelihood || 'possible']}`}>{t(c.likelihood || 'possible')}</span>
          </div>
          <p className="mt-1 text-sm text-slate-600">{c.reasoning || c.rationale} {c.evidence.map(e => <sup key={e} className="text-brand-600">[{e}]</sup>)}</p>
        </motion.div>
      ))}
    </div>
  )
}

export default function SymptomPanel({ result: raw, busy, input, onQuestion }: { result: SymptomResult | null; busy: boolean; input: string | null; onQuestion?: (q: string) => void }) {
  const { t } = useLang()
  const { data: result, translating, error } = useTranslated(raw)
  if (busy) return (
    <div className="flex flex-col items-center gap-3 py-16 text-slate-500">
      <Loader2 className="animate-spin text-brand-600" size={32} />
      <p className="text-sm">{t('Analyzing symptoms and searching medical research…')}</p>
      {input && <p className="max-w-md text-center text-xs italic">“{input}”</p>}
    </div>
  )
  if (!result) return (
    <div className="py-16 text-center">
      <Stethoscope className="mx-auto mb-3 text-brand-500" size={36} />
      <p className="font-medium">Describe the symptoms by voice or text</p>
      <p className="mt-1 text-sm text-slate-500">e.g. “35-year-old woman with fever, joint pain and a rash for three days”</p>
    </div>
  )
  const ex = result.extracted
  return (
    <div className="space-y-4">
      <TranslatingNote translating={translating} error={error} />
      {result.spoken_summary && (
        <div className="rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 p-4 text-white">
          <div className="text-xs uppercase tracking-wide opacity-80">{t('Summary')}</div>
          <p className="mt-1 leading-relaxed">{result.spoken_summary}</p>
        </div>
      )}
      <div className="rounded-xl border border-slate-200 p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{t('What I understood')}</div>
        <div className="flex flex-wrap gap-1.5">
          {(ex.symptoms || []).map((s, i) => <span key={i} className="chip bg-brand-100 text-brand-800" title={s.details || ''}>{s.name}{s.details ? ` · ${s.details}` : ''}</span>)}
          {ex.age && <span className="chip bg-slate-100 text-slate-600">age {ex.age}</span>}
          {ex.sex && <span className="chip bg-slate-100 text-slate-600">{ex.sex}</span>}
          {ex.duration && <span className="chip bg-slate-100 text-slate-600">{ex.duration}</span>}
        </div>
        {ex.context && <p className="mt-1.5 text-xs text-slate-500">{ex.context}</p>}
      </div>

      <SeverityMeter level={result.severity} title={t('How urgent does it look?')} />

      {!!result.possible_conditions?.length && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">{t('Possible conditions (prediction, not a diagnosis)')}</h3>
          <ConditionCards items={result.possible_conditions} />
        </section>
      )}

      {!!result.red_flags?.length && (
        <section className="rounded-xl border border-rose-200 bg-rose-50 p-3">
          <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-rose-700"><AlertOctagon size={15} />{t('Red flags to rule out')}</h3>
          <ul className="list-disc pl-5 text-sm text-rose-800">{result.red_flags.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </section>
      )}

      <CareGrid causes={result.causes} precautions={result.precautions} avoid={result.avoid} prevention={result.prevention} seeDoctor={result.see_doctor_if} />

      {!!result.follow_up_questions?.length && onQuestion && (
        <section className="rounded-2xl border border-brand-200 bg-brand-50/60 p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-brand-800"><MessageCircleQuestion size={16} />{t('Help me narrow it down — tap a question and answer by voice')}</h3>
          <div className="flex flex-wrap gap-2">
            {result.follow_up_questions.map((q, i) => (
              <motion.button key={i} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.06 }}
                whileHover={{ scale: 1.03 }} onClick={() => onQuestion(q)}
                className="rounded-full border border-brand-200 bg-white px-3 py-1.5 text-left text-sm text-brand-800 shadow-sm hover:border-brand-400">{q}</motion.button>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {!!result.recommended_evaluation?.length && (
          <section className="rounded-xl border border-slate-200 p-3">
            <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><ClipboardList size={15} className="text-brand-600" />{t('Suggested evaluation')}</h3>
            <ul className="list-disc pl-5 text-sm">{result.recommended_evaluation.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </section>
        )}
        {!!result.follow_up_questions?.length && !onQuestion && (
          <section className="rounded-xl border border-slate-200 p-3">
            <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><HelpCircle size={15} className="text-brand-600" />Questions to ask next</h3>
            <ul className="list-disc pl-5 text-sm">{result.follow_up_questions.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </section>
        )}
      </div>

      {result.warnings.map((w, i) => <div key={i} className="text-xs text-amber-700">⚠ {w}</div>)}
      <details>
        <summary className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-slate-600"><BookOpen size={13} />Supporting evidence ({result.evidence.length})</summary>
        <div className="mt-2"><EvidenceList evidence={result.evidence} /></div>
      </details>
      <p className="text-[11px] text-slate-400">{result.limitations.join(' ')}</p>
    </div>
  )
}
