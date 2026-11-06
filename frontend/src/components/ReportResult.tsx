import { useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  AlertTriangle, BookOpen, Check, ClipboardList, Download, Eye, FileText, HeartPulse, Loader2, ShieldCheck, Stethoscope,
  TrendingDown, TrendingUp, Volume2, XCircle, type LucideIcon,
} from 'lucide-react'
import type { Analysis, BBox, Doc, LabRow, Severity } from '../types'
import { ConditionCards } from './SymptomPanel'
import { EvidenceList } from './AnalysisPanel'
import ExtractionViewer from './ExtractionViewer'
import { TranslatingNote, useLang, useTranslated } from '../i18n'

type Stage = 'extracting' | 'analyzing' | 'interpreting' | 'done'

interface Props {
  doc: Doc
  analysis: Analysis | null
  stage: Stage
  onReadAloud: () => void
  onDownload: () => void
  downloading: boolean
}

const ABNORMAL = ['high', 'low', 'abnormal']

const FLAG: Record<string, { label: string; cls: string; Icon?: LucideIcon }> = {
  high: { label: 'High', cls: 'bg-rose-100 text-rose-700 ring-rose-200', Icon: TrendingUp },
  low: { label: 'Low', cls: 'bg-sky-100 text-sky-700 ring-sky-200', Icon: TrendingDown },
  abnormal: { label: 'Abnormal', cls: 'bg-rose-100 text-rose-700 ring-rose-200', Icon: AlertTriangle },
  normal: { label: 'Normal', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
}

const PRIORITY: Record<string, { label: string; cls: string; bar: string; level: number }> = {
  normal: { label: 'Routine', cls: 'bg-emerald-600', bar: 'bg-emerald-500', level: 1 },
  mild: { label: 'Low', cls: 'bg-lime-600', bar: 'bg-lime-500', level: 2 },
  moderate: { label: 'Moderate', cls: 'bg-amber-500', bar: 'bg-amber-500', level: 3 },
  serious: { label: 'High', cls: 'bg-rose-600', bar: 'bg-rose-500', level: 4 },
}

const STEPS: { key: Stage; label: string }[] = [
  { key: 'extracting', label: 'Reading' }, { key: 'analyzing', label: 'Extracting values' },
  { key: 'interpreting', label: 'Understanding' }, { key: 'done', label: 'Ready' },
]

function Progress({ stage }: { stage: Stage }) {
  const { t } = useLang()
  const cur = STEPS.findIndex(s => s.key === stage)
  return (
    <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-3">
      {STEPS.map((s, i) => (
        <div key={s.key} className="flex flex-1 items-center gap-1.5">
          <motion.span animate={i === cur && stage !== 'done' ? { scale: [1, 1.15, 1] } : { scale: 1 }} transition={{ duration: 1, repeat: Infinity }}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i < cur || stage === 'done' ? 'bg-emerald-500 text-white' : i === cur ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
            {i < cur || stage === 'done' ? <Check size={14} /> : i === cur ? <Loader2 size={14} className="animate-spin" /> : i + 1}
          </motion.span>
          <span className={`hidden text-xs sm:inline ${i <= cur ? 'font-medium text-slate-700' : 'text-slate-400'}`}>{t(s.label)}</span>
          {i < STEPS.length - 1 && <div className="mx-1 h-0.5 flex-1 overflow-hidden rounded bg-slate-100">
            <motion.div className="h-full bg-emerald-400" animate={{ width: i < cur ? '100%' : '0%' }} /></div>}
        </div>
      ))}
    </div>
  )
}

function parseRange(ref: string | null): [number, number] | null {
  const m = (ref || '').match(/(-?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?)/i)
  if (!m) return null
  const lo = Number(m[1]), hi = Number(m[2])
  return hi > lo ? [lo, hi] : null
}

/** Labs often print the unit inside the result ("84 µmol/L", "8.6% (70 mmol/mol)"); show them in their own columns. */
function splitResult(r: LabRow): [string, string | null] {
  if (r.unit) return [r.result, r.unit]
  const m = r.result.match(/^([<>≤≥]=?\s*)?(-?\d+(?:[.,]\d+)?)\s*([%A-Za-zµμ/(].*)$/)
  return m ? [`${m[1] || ''}${m[2]}`, m[3].trim()] : [r.result, null]
}

/** Numbered report section with a formal heading rule. */
function Section({ n, title, Icon, children, aside }: { n: number; title: string; Icon: LucideIcon; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="break-inside-avoid">
      <div className="mb-3 flex items-center gap-2 border-b-2 border-brand-700/80 pb-1.5">
        <span className="flex h-6 w-6 items-center justify-center rounded bg-brand-700 text-[11px] font-bold text-white">{n}</span>
        <Icon size={16} className="text-brand-700" />
        <h3 className="text-[13px] font-bold uppercase tracking-[0.08em] text-brand-900">{title}</h3>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  )
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className={`truncate text-sm font-semibold ${value ? 'text-slate-900' : 'font-normal italic text-slate-400'}`} title={value || ''}>{value || '—'}</dd>
    </div>
  )
}

function FlagBadge({ status, note }: { status: string; note: string }) {
  const { t } = useLang()
  const f = FLAG[status]
  if (!f) return <span className="text-xs text-slate-400" title={note}>—</span>
  return (
    <span title={note} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ring-1 ${f.cls}`}>
      {f.Icon && <f.Icon size={11} />}{t(f.label)}
    </span>
  )
}

/** One abnormal value with a low / normal / high scale and a plain-language meaning. */
function FindingCard({ row, meaning, i }: { row: LabRow; meaning?: string; i: number }) {
  const { t } = useLang()
  const st = row.evaluation.status
  const high = st === 'high' || st === 'abnormal'
  const range = parseRange(row.reference_interval)
  const v = parseFloat(row.result.replace(/[<>,]/g, ''))
  const pos = range && !isNaN(v) ? Math.min(97, Math.max(3, 25 + ((v - range[0]) / (range[1] - range[0])) * 50)) : high ? 88 : 12
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
      className={`rounded-lg border-l-4 bg-white p-3.5 ring-1 ring-slate-200 ${high ? 'border-l-rose-500' : 'border-l-sky-500'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold text-slate-900" data-no-translate>{row.test_name}</div>
        <FlagBadge status={st} note={row.evaluation.note} />
      </div>
      <div className="mt-1 flex items-baseline gap-2" data-no-translate>
        <span className="text-xl font-bold tabular-nums text-slate-900">{row.result}</span>
        {row.unit && <span className="text-xs text-slate-500">{row.unit}</span>}
        {row.reference_interval && <span className="ml-auto text-[11px] text-slate-400">{t('Ref.')} {row.reference_interval}</span>}
      </div>
      {st !== 'abnormal' && (
        <>
          <div className="relative mt-2.5 h-1.5 rounded-full bg-gradient-to-r from-sky-200 via-emerald-200 to-rose-200">
            <div className="absolute inset-y-0 left-1/4 right-1/4 rounded-full bg-emerald-300/80" />
            <motion.span className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ${high ? 'bg-rose-500' : 'bg-sky-500'}`}
              initial={{ left: '50%' }} animate={{ left: `${pos}%` }} transition={{ delay: 0.2 + i * 0.05, type: 'spring', stiffness: 80 }} />
          </div>
          <div className="mt-1 flex justify-between text-[9px] font-medium uppercase tracking-wide text-slate-400"><span>{t('Low')}</span><span>{t('Normal')}</span><span>{t('High')}</span></div>
        </>
      )}
      {meaning && <p className="mt-2 text-[13px] leading-snug text-slate-600">{meaning}</p>}
    </motion.div>
  )
}

function AdviceBlock({ title, items, tone, Icon }: { title: string; items?: string[]; tone: string; Icon: LucideIcon }) {
  if (!items?.length) return null
  return (
    <div className={`rounded-lg border-t-4 bg-white p-3.5 ring-1 ring-slate-200 ${tone}`}>
      <h4 className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-slate-800"><Icon size={15} />{title}</h4>
      <ul className="space-y-1.5">
        {items.map((x, i) => <li key={i} className="flex gap-2 text-[13px] leading-snug text-slate-700"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" />{x}</li>)}
      </ul>
    </div>
  )
}

export default function ReportResult({ doc, analysis, stage, onReadAloud, onDownload, downloading }: Props) {
  const { t } = useLang()
  const [showOriginal, setShowOriginal] = useState(false)
  const [onlyAbnormal, setOnlyAbnormal] = useState(false)
  const [highlight, setHighlight] = useState<{ page: number; bbox: BBox } | null>(null)
  const s = analysis?.structured
  const rawIt = analysis?.interpretation
  const tr = useTranslated(rawIt ? { ...rawIt, evidence: undefined } : null)
  const it = rawIt ? { ...rawIt, ...(tr.data || {}), evidence: rawIt.evidence } : undefined
  const rows = s?.rows || []
  const abn = rows.filter(r => ABNORMAL.includes(r.evaluation.status))
  const evaluated = rows.filter(r => ['high', 'low', 'abnormal', 'normal'].includes(r.evaluation.status)).length
  const shownRows = onlyAbnormal ? abn : rows
  // tolerant name match: "Haemoglobin" ~ "Hemoglobin (Hb)", "Platelet Count" ~ "Platelets"
  const norm = (x: string) => x.toLowerCase().replace(/\(.*?\)/g, '').replace(/ae/g, 'e').replace(/[^a-z0-9]/g, '').replace(/s$/, '')
  const same = (a: string, b: string) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)) }
  const meaningOf = (name: string) => it?.plain_findings?.find(f => same(f.test, name))?.meaning
    || it?.abnormal_findings?.find(f => same(f.test, name))?.explanation
  const pt = s?.patient || {}
  const status = analysis?.review_status || 'pending'
  const stamp = status === 'approved' ? { label: 'Approved', cls: 'border-emerald-600 text-emerald-700', Icon: ShieldCheck }
    : status === 'rejected' ? { label: 'Rejected', cls: 'border-rose-600 text-rose-700', Icon: XCircle }
      : { label: 'Pending doctor review', cls: 'border-amber-500 text-amber-600', Icon: ClipboardList }
  const pr = PRIORITY[(it?.severity as Severity) || ''] || null
  const reportId = analysis ? `MLR-${String(analysis.id).padStart(6, '0')}` : '—'
  const when = analysis?.created_at ? new Date(analysis.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null
  const pages = doc.extraction?.pages?.length

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {/* action bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto flex min-w-0 items-center gap-2 text-sm text-slate-500"><FileText size={16} className="shrink-0" /><span className="truncate" data-no-translate>{doc.filename}</span></div>
        <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setShowOriginal(v => !v)}><Eye size={14} />{t(showOriginal ? 'Hide original' : 'Show original')}</button>
        {stage === 'done' && <button className="btn-ghost !py-1.5 !text-xs" onClick={onReadAloud}><Volume2 size={14} />{t('Read aloud')}</button>}
        {stage === 'done' && analysis && <button className="btn-primary !py-1.5 !text-xs" onClick={onDownload} disabled={downloading}>
          {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}{t('Approve & download PDF')}</button>}
      </div>

      {stage !== 'done' && <Progress stage={stage} />}
      <TranslatingNote translating={tr.translating} error={tr.error} />

      {/* ---------- the report sheet ---------- */}
      <article className="overflow-hidden rounded-xl bg-white shadow-md ring-1 ring-slate-200">
        {/* letterhead */}
        <header className="relative bg-gradient-to-r from-brand-800 via-brand-700 to-brand-600 px-6 py-4 text-white">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/30"><HeartPulse size={24} /></div>
              <div className="leading-tight">
                <div className="text-lg font-bold tracking-wide" translate="no">MedLens</div>
                <div className="text-[11px] uppercase tracking-[0.15em] text-white/75">{t('Clinical report analysis')}</div>
              </div>
            </div>
            <div className="ml-auto text-right text-[11px] leading-relaxed text-white/85">
              <div>{t('Report ID')}: <b className="font-mono text-white" data-no-translate>{reportId}</b></div>
              {when && <div>{t('Generated')}: <span data-no-translate>{when}</span></div>}
            </div>
          </div>
        </header>
        <div className="h-1 bg-gradient-to-r from-brand-400 via-teal-300 to-violet-400" />

        <div className="space-y-7 px-5 py-6 sm:px-7">
          {/* title + stamp */}
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{t('Investigation')}</div>
              <h2 className="text-2xl font-bold text-slate-900">{s?.report_type || t('Reading document…')}</h2>
            </div>
            <motion.div initial={{ scale: 1.3, opacity: 0, rotate: -12 }} animate={{ scale: 1, opacity: 1, rotate: -6 }} transition={{ type: 'spring', stiffness: 160, damping: 12 }}
              className={`flex items-center gap-1.5 rounded-md border-2 border-dashed px-3 py-1.5 text-xs font-extrabold uppercase tracking-wider ${stamp.cls}`}>
              <stamp.Icon size={15} />{t(stamp.label)}
            </motion.div>
          </div>

          {/* patient & specimen panel */}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-3">
            <Field label={t('Patient name')} value={pt.patient_name} />
            <Field label={t('Age / Sex')} value={[pt.age, pt.gender].filter(Boolean).join(' / ') || null} />
            <Field label={t('Report date')} value={pt.report_date} />
            <Field label={t('Laboratory')} value={pt.laboratory_name} />
            <Field label={t('Source document')} value={doc.filename} />
            <Field label={t('Pages')} value={pages ? String(pages) : null} />
          </dl>

          {/* summary stats */}
          {rows.length > 0 && (
            <div className="grid grid-cols-3 divide-x divide-slate-200 overflow-hidden rounded-lg border border-slate-200 text-center">
              <div className="p-3"><div className="text-2xl font-bold tabular-nums text-slate-900">{rows.length}</div><div className="text-[11px] text-slate-500">{t('Tests reported')}</div></div>
              <div className="p-3"><div className={`text-2xl font-bold tabular-nums ${abn.length ? 'text-rose-600' : 'text-emerald-600'}`}>{abn.length}</div><div className="text-[11px] text-slate-500">{t('Outside reference range')}</div></div>
              <div className="p-3"><div className="text-2xl font-bold tabular-nums text-emerald-600">{evaluated - abn.length}</div><div className="text-[11px] text-slate-500">{t('Within reference range')}</div></div>
            </div>
          )}

          {/* 1. impression */}
          {(it?.spoken_summary || it?.summary || pr) && (
            <Section n={1} title={t('Clinical impression')} Icon={Stethoscope}
              aside={pr && <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white ${pr.cls}`}>{t('Priority')}: {t(pr.label)}</span>}>
              <div className="rounded-lg border-l-4 border-brand-600 bg-brand-50/60 p-4">
                <p className="text-[15px] leading-relaxed text-slate-800">{it?.summary || it?.spoken_summary}</p>
                {pr && (
                  <div className="mt-3">
                    <div className="flex gap-1">{[1, 2, 3, 4].map(l => <motion.div key={l} className={`h-1.5 flex-1 rounded-full ${l <= pr.level ? pr.bar : 'bg-slate-200'}`} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.1 * l }} style={{ originX: 0 }} />)}</div>
                    {it?.severity_reason && <p className="mt-1.5 text-xs text-slate-600">{it.severity_reason}</p>}
                  </div>
                )}
              </div>
              {!!it?.key_points?.length && (
                <ol className="mt-3 grid gap-2 sm:grid-cols-2">
                  {it.key_points.map((k, i) => (
                    <li key={i} className="flex items-start gap-2.5 rounded-lg bg-white p-2.5 text-[13px] text-slate-700 ring-1 ring-slate-200">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-700 text-[10px] font-bold text-white">{i + 1}</span>{k}
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          )}

          {/* 2. results table */}
          {rows.length > 0 && (
            <Section n={2} title={t('Test results')} Icon={ClipboardList}
              aside={abn.length > 0 && (
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" className="accent-brand-600" checked={onlyAbnormal} onChange={e => setOnlyAbnormal(e.target.checked)} />{t('Abnormal only')}
                </label>
              )}>
              <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="bg-slate-800 text-left text-[11px] uppercase tracking-wider text-white">
                    <tr>
                      <th className="px-3 py-2.5 font-semibold">{t('Investigation')}</th>
                      <th className="px-3 py-2.5 text-right font-semibold">{t('Result')}</th>
                      <th className="px-3 py-2.5 font-semibold">{t('Unit')}</th>
                      <th className="px-3 py-2.5 font-semibold">{t('Reference range')}</th>
                      <th className="px-3 py-2.5 text-center font-semibold">{t('Flag')}</th>
                    </tr>
                  </thead>
                  <tbody data-no-translate>
                    {shownRows.map((r, i) => {
                      const bad = ABNORMAL.includes(r.evaluation.status)
                      return (
                        <tr key={i} className={`border-t border-slate-100 transition-colors hover:bg-amber-50 ${bad ? (r.evaluation.status === 'low' ? 'bg-sky-50/70' : 'bg-rose-50/70') : i % 2 ? 'bg-slate-50/60' : 'bg-white'}`}
                          onMouseEnter={() => { if (r.bbox) setHighlight({ page: r.page, bbox: r.bbox }) }} onMouseLeave={() => setHighlight(null)}>
                          <td className={`px-3 py-2 ${bad ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{r.test_name}</td>
                          <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${bad ? 'font-bold text-slate-900' : 'text-slate-800'}`}>
                            {splitResult(r)[0]}
                            {r.verification !== 'source-matched' && <span className="ml-1 text-amber-600" title={t('Requires manual verification')}>*</span>}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-slate-500">{splitResult(r)[1] || '—'}</td>
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-500">{r.reference_interval || '—'}</td>
                          <td className="px-3 py-2 text-center"><FlagBadge status={r.evaluation.status} note={r.evaluation.note} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                {t('Flags compare each result only with the reference range printed on the original report.')}
                {rows.some(r => r.verification !== 'source-matched') && <> <span className="text-amber-600">*</span> {t('Value needs manual verification against the original.')}</>}
              </p>
            </Section>
          )}

          {rows.length > 0 && abn.length === 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 ring-1 ring-emerald-200">
              <Check className="text-emerald-600" size={18} />{t("All {n} values are within the report's normal ranges.", { n: evaluated })}
            </div>
          )}

          {/* 3. abnormal findings explained */}
          {abn.length > 0 && (
            <Section n={3} title={t('Abnormal findings explained')} Icon={AlertTriangle}>
              <div className="grid gap-3 sm:grid-cols-2">{abn.map((r, i) => <FindingCard key={i} row={r} meaning={meaningOf(r.test_name)} i={i} />)}</div>
            </Section>
          )}

          {/* 4. clinical considerations */}
          {!!it?.differential_considerations?.length && (
            <Section n={4} title={t('Clinical considerations')} Icon={Stethoscope}>
              <ConditionCards items={it.differential_considerations} />
              <p className="mt-2 text-[11px] text-slate-400">{t('Possibilities to discuss with a doctor, not a diagnosis.')}</p>
            </Section>
          )}

          {/* 5. recommendations */}
          {!!(it?.precautions?.length || it?.avoid?.length || it?.lifestyle?.length || it?.see_doctor_if?.length) && (
            <Section n={5} title={t('Recommendations')} Icon={ShieldCheck}>
              <div className="grid gap-3 sm:grid-cols-2">
                <AdviceBlock title={t('Precautions to take')} items={it?.precautions} tone="border-t-emerald-500 text-emerald-700" Icon={Check} />
                <AdviceBlock title={t('Things to avoid')} items={it?.avoid} tone="border-t-rose-500 text-rose-700" Icon={XCircle} />
                <AdviceBlock title={t('Healthy habits')} items={it?.lifestyle} tone="border-t-teal-500 text-teal-700" Icon={HeartPulse} />
                <AdviceBlock title={t('See a doctor quickly if')} items={it?.see_doctor_if} tone="border-t-amber-500 text-amber-700" Icon={AlertTriangle} />
              </div>
            </Section>
          )}

          {/* 6. further evaluation */}
          {!!it?.suggested_further_evaluation?.length && (
            <Section n={6} title={t('Suggested further evaluation')} Icon={ClipboardList}>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {it.suggested_further_evaluation.map((x, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px] text-slate-700"><Check size={14} className="mt-0.5 shrink-0 text-brand-600" />{x}</li>
                ))}
              </ul>
            </Section>
          )}

          {s?.warnings.filter(w => !w.startsWith('GROQ')).map((w, i) => <div key={i} className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 ring-1 ring-amber-200">⚠ {w}</div>)}

          {!!it?.evidence?.length && (
            <details className="rounded-lg ring-1 ring-slate-200">
              <summary className="flex cursor-pointer items-center gap-1.5 px-4 py-3 text-sm font-semibold text-slate-700"><BookOpen size={15} />{t('References')} ({it.evidence.length})</summary>
              <div className="border-t border-slate-100 p-4"><EvidenceList evidence={it.evidence} /></div>
            </details>
          )}

          {/* verification footer */}
          {stage === 'done' && (
            <footer className="grid gap-4 border-t-2 border-dashed border-slate-200 pt-5 sm:grid-cols-[1fr_auto]">
              <p className="text-[11px] leading-relaxed text-slate-500">
                {t('Electronically generated by MedLens as clinical decision support. It is not a diagnosis and must be verified by a registered medical practitioner before any treatment decision.')}
              </p>
              <div className="text-center sm:min-w-[200px]">
                <div className="h-8 border-b border-slate-400" />
                <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{t('Verified by (doctor)')}</div>
              </div>
            </footer>
          )}
        </div>
      </article>

      {showOriginal && <div className="h-[520px]"><ExtractionViewer doc={doc} highlight={highlight} onHighlight={setHighlight} /></div>}
    </motion.div>
  )
}
