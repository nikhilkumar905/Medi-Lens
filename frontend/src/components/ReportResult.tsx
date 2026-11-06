import { useState } from 'react'
import { motion } from 'framer-motion'
import { BookOpen, Check, Download, Eye, FileText, Loader2, Table2, TrendingDown, TrendingUp, Volume2 } from 'lucide-react'
import type { Analysis, BBox, Doc, LabRow } from '../types'
import { ConditionCards } from './SymptomPanel'
import { EvidenceList } from './AnalysisPanel'
import ExtractionViewer from './ExtractionViewer'
import { CareGrid, KeyPoints, SeverityMeter, TipCard } from './CareCards'

const STATUS: Record<string, string> = {
  high: 'bg-rose-100 text-rose-700', low: 'bg-sky-100 text-sky-700', normal: 'bg-emerald-100 text-emerald-700',
}

type Stage = 'extracting' | 'analyzing' | 'interpreting' | 'done'

interface Props {
  doc: Doc
  analysis: Analysis | null
  stage: Stage
  onReadAloud: () => void
  onDownload: () => void
  downloading: boolean
}

const STEPS: { key: Stage; label: string }[] = [
  { key: 'extracting', label: 'Reading' }, { key: 'analyzing', label: 'Extracting values' },
  { key: 'interpreting', label: 'Understanding' }, { key: 'done', label: 'Ready' },
]

function Progress({ stage }: { stage: Stage }) {
  const cur = STEPS.findIndex(s => s.key === stage)
  return (
    <div className="flex items-center gap-1 rounded-2xl bg-white p-3 shadow-sm">
      {STEPS.map((s, i) => (
        <div key={s.key} className="flex flex-1 items-center gap-1.5">
          <motion.span animate={i === cur && stage !== 'done' ? { scale: [1, 1.15, 1] } : { scale: 1 }} transition={{ duration: 1, repeat: Infinity }}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i < cur || stage === 'done' ? 'bg-emerald-500 text-white' : i === cur ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
            {i < cur || stage === 'done' ? <Check size={14} /> : i === cur ? <Loader2 size={14} className="animate-spin" /> : i + 1}
          </motion.span>
          <span className={`hidden text-xs sm:inline ${i <= cur ? 'font-medium text-slate-700' : 'text-slate-400'}`}>{s.label}</span>
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

/** One abnormal value with a low / normal / high bar and a plain-language meaning. */
function ValueCard({ row, meaning, i }: { row: LabRow; meaning?: string; i: number }) {
  const high = row.evaluation.status === 'high'
  const range = parseRange(row.reference_interval)
  const v = parseFloat(row.result.replace(/[<>,]/g, ''))
  const pos = range && !isNaN(v) ? Math.min(97, Math.max(3, 25 + ((v - range[0]) / (range[1] - range[0])) * 50)) : high ? 88 : 12
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }} whileHover={{ y: -3 }}
      className={`rounded-2xl border bg-white p-4 shadow-sm ${high ? 'border-rose-200' : 'border-sky-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-slate-900">{row.test_name}</div>
        <span className={`chip ${STATUS[row.evaluation.status]}`}>{high ? <TrendingUp size={12} /> : <TrendingDown size={12} />}{high ? 'High' : 'Low'}</span>
      </div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{row.result} <span className="text-sm font-normal text-slate-500">{row.unit}</span></div>
      <div className="relative mt-3 h-2 rounded-full bg-gradient-to-r from-sky-200 via-emerald-200 to-rose-200">
        <div className="absolute inset-y-0 left-1/4 right-1/4 rounded-full bg-emerald-300/70" />
        <motion.span className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ${high ? 'bg-rose-500' : 'bg-sky-500'}`}
          initial={{ left: '50%' }} animate={{ left: `${pos}%` }} transition={{ delay: 0.3 + i * 0.07, type: 'spring', stiffness: 80 }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] uppercase text-slate-400"><span>Low</span><span>Normal {row.reference_interval ? `(${row.reference_interval})` : ''}</span><span>High</span></div>
      {meaning && <p className="mt-2 text-sm text-slate-600">{meaning}</p>}
    </motion.div>
  )
}

export default function ReportResult({ doc, analysis, stage, onReadAloud, onDownload, downloading }: Props) {
  const [showOriginal, setShowOriginal] = useState(false)
  const [showTable, setShowTable] = useState(false)
  const [highlight, setHighlight] = useState<{ page: number; bbox: BBox } | null>(null)
  const s = analysis?.structured
  const it = analysis?.interpretation
  const abn = s?.rows.filter(r => ['high', 'low'].includes(r.evaluation.status)) || []
  // tolerant name match: "Haemoglobin" ~ "Hemoglobin (Hb)", "Platelet Count" ~ "Platelets"
  const norm = (x: string) => x.toLowerCase().replace(/\(.*?\)/g, '').replace(/ae/g, 'e').replace(/[^a-z0-9]/g, '').replace(/s$/, '')
  const same = (a: string, b: string) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)) }
  const meaningOf = (name: string) => it?.plain_findings?.find(f => same(f.test, name))?.meaning
    || it?.abnormal_findings?.find(f => same(f.test, name))?.explanation

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-100 text-brand-700"><FileText size={22} /></div>
        <div className="mr-auto min-w-0">
          <div className="truncate font-semibold text-slate-900">{doc.filename}</div>
          <div className="text-xs text-slate-500">{s?.report_type || 'Reading document…'}{s?.patient.report_date ? ` · ${s.patient.report_date}` : ''}</div>
        </div>
        <button className="btn-ghost !py-1.5 !text-xs" onClick={() => setShowOriginal(v => !v)}><Eye size={14} />{showOriginal ? 'Hide' : 'Show'} original</button>
        {stage === 'done' && <button className="btn-ghost !py-1.5 !text-xs" onClick={onReadAloud}><Volume2 size={14} />Read aloud</button>}
        {stage === 'done' && analysis && <button className="btn-primary !py-1.5 !text-xs" onClick={onDownload} disabled={downloading}>
          {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}Approve & download PDF</button>}
      </div>

      {stage !== 'done' && <Progress stage={stage} />}

      {(it?.spoken_summary || it?.summary) && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-500 p-5 text-white shadow-md">
          <motion.div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/10" animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 4, repeat: Infinity }} />
          <div className="text-xs font-semibold uppercase tracking-wider opacity-80">In short</div>
          <p className="relative mt-1.5 text-[15px] leading-relaxed">{it.spoken_summary || it.summary}</p>
        </motion.div>
      )}

      <SeverityMeter level={it?.severity} reason={it?.severity_reason} />
      <KeyPoints items={it?.key_points} />

      {s && (abn.length > 0 ? (
        <section>
          <h3 className="mb-2 text-sm font-bold text-slate-800">Values outside the normal range ({abn.length})</h3>
          <div className="grid gap-3 sm:grid-cols-2">{abn.map((r, i) => <ValueCard key={i} row={r} meaning={meaningOf(r.test_name)} i={i} />)}</div>
        </section>
      ) : s.rows.length > 0 && (
        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800">
          <Check className="text-emerald-600" />All {s.rows.length} values are within the report's normal ranges.
        </motion.div>
      ))}

      {!!it?.differential_considerations?.length && (
        <section>
          <h3 className="mb-2 text-sm font-bold text-slate-800">What it could point to</h3>
          <ConditionCards items={it.differential_considerations} />
        </section>
      )}

      <CareGrid precautions={it?.precautions} avoid={it?.avoid} lifestyle={it?.lifestyle} seeDoctor={it?.see_doctor_if} />
      <TipCard title="Suggested next tests / steps" items={it?.suggested_further_evaluation} tone="info" delay={0.3} />

      {s && s.rows.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <button className="flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold hover:bg-slate-50" onClick={() => setShowTable(v => !v)}>
            <Table2 size={15} className="text-brand-600" />All test results ({s.rows.length})<span className="ml-auto text-xs font-normal text-slate-400">{showTable ? 'Hide' : 'Show'}</span>
          </button>
          {showTable && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr><th className="px-4 py-2">Test</th><th className="px-4 py-2">Result</th><th className="hidden px-4 py-2 sm:table-cell">Reference</th><th className="px-4 py-2">Status</th></tr>
              </thead>
              <tbody>
                {s.rows.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100 hover:bg-amber-50"
                    onMouseEnter={() => { if (r.bbox) setHighlight({ page: r.page, bbox: r.bbox }) }} onMouseLeave={() => setHighlight(null)}>
                    <td className="px-4 py-2 font-medium">{r.test_name}</td>
                    <td className="whitespace-nowrap px-4 py-2 font-mono">{r.result} <span className="font-sans text-slate-500">{r.unit}</span>
                      {r.verification === 'Requires manual verification' && <span className="ml-1 text-amber-600" title="Requires manual verification">⚠</span>}</td>
                    <td className="hidden whitespace-nowrap px-4 py-2 font-mono text-slate-500 sm:table-cell">{r.reference_interval || '—'}</td>
                    <td className="px-4 py-2"><span className={`chip ${STATUS[r.evaluation.status] || 'bg-slate-100 text-slate-500'}`}>{r.evaluation.status.replace('_', ' ')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {s?.warnings.filter(w => !w.startsWith('GROQ')).map((w, i) => <div key={i} className="rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800">⚠ {w}</div>)}

      {showOriginal && <div className="h-[520px]"><ExtractionViewer doc={doc} highlight={highlight} onHighlight={setHighlight} /></div>}

      {!!it?.evidence?.length && (
        <details className="rounded-2xl border border-slate-200 bg-white p-4">
          <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-slate-700"><BookOpen size={15} />Medical evidence ({it.evidence.length})</summary>
          <div className="mt-3"><EvidenceList evidence={it.evidence} /></div>
        </details>
      )}
      {stage === 'done' && <p className="text-center text-[11px] text-slate-400">AI decision support — not a diagnosis. Please review with a doctor before acting.</p>}
    </motion.div>
  )
}
