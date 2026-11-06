import { useState } from 'react'
import { motion } from 'framer-motion'
import { BookOpen, ClipboardList, Download, Eye, FileText, Loader2, Volume2 } from 'lucide-react'
import type { Analysis, BBox, Doc } from '../types'
import { ConditionCards } from './SymptomPanel'
import { EvidenceList } from './AnalysisPanel'
import ExtractionViewer from './ExtractionViewer'

const STATUS: Record<string, string> = {
  high: 'bg-rose-100 text-rose-700', low: 'bg-sky-100 text-sky-700', normal: 'bg-emerald-100 text-emerald-700',
}

interface Props {
  doc: Doc
  analysis: Analysis | null
  stage: 'extracting' | 'analyzing' | 'interpreting' | 'done'
  onReadAloud: () => void
  onDownload: () => void
  downloading: boolean
}

export default function ReportResult({ doc, analysis, stage, onReadAloud, onDownload, downloading }: Props) {
  const [showOriginal, setShowOriginal] = useState(false)
  const [highlight, setHighlight] = useState<{ page: number; bbox: BBox } | null>(null)
  const s = analysis?.structured
  const it = analysis?.interpretation
  const abn = s?.rows.filter(r => ['high', 'low'].includes(r.evaluation.status)) || []

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

      {stage !== 'done' && (
        <div className="flex items-center gap-3 rounded-2xl bg-brand-50 p-4 text-sm text-brand-800">
          <Loader2 className="animate-spin" size={18} />
          {stage === 'extracting' ? 'Reading the document…' : stage === 'analyzing' ? 'Extracting test values…' : 'Working out what the results mean…'}
        </div>
      )}

      {it?.spoken_summary || it?.summary ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-500 p-5 text-white shadow-md">
          <div className="text-xs font-semibold uppercase tracking-wider opacity-80">Summary</div>
          <p className="mt-1.5 text-[15px] leading-relaxed">{it.spoken_summary || it.summary}</p>
        </motion.div>
      ) : null}

      {s && (abn.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {abn.map((r, i) => (
            <span key={i} className={`chip !px-3 !py-1 !text-sm ${STATUS[r.evaluation.status]}`}>
              {r.evaluation.status === 'high' ? '▲' : '▼'} {r.test_name} {r.result} {r.unit || ''}
            </span>
          ))}
        </div>
      ) : s.rows.length > 0 && <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">All extracted values are within the report's reference ranges.</div>)}

      {!!it?.differential_considerations?.length && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-slate-800">Possible conditions</h3>
          <ConditionCards items={it.differential_considerations} />
        </section>
      )}

      {!!it?.suggested_further_evaluation?.length && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"><ClipboardList size={15} className="text-brand-600" />Suggested next steps</h3>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">{it.suggested_further_evaluation.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </section>
      )}

      {s && s.rows.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-2.5 text-sm font-semibold">Test results</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-2">Test</th><th className="px-4 py-2">Result</th><th className="hidden px-4 py-2 sm:table-cell">Reference</th><th className="px-4 py-2">Status</th></tr>
            </thead>
            <tbody>
              {s.rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100 hover:bg-amber-50"
                  onMouseEnter={() => { if (r.bbox) { setHighlight({ page: r.page, bbox: r.bbox }) } }} onMouseLeave={() => setHighlight(null)}>
                  <td className="px-4 py-2 font-medium">{r.test_name}</td>
                  <td className="whitespace-nowrap px-4 py-2 font-mono">{r.result} <span className="font-sans text-slate-500">{r.unit}</span>
                    {r.verification === 'Requires manual verification' && <span className="ml-1 text-amber-600" title="Requires manual verification">⚠</span>}</td>
                  <td className="hidden whitespace-nowrap px-4 py-2 font-mono text-slate-500 sm:table-cell">{r.reference_interval || '—'}</td>
                  <td className="px-4 py-2"><span className={`chip ${STATUS[r.evaluation.status] || 'bg-slate-100 text-slate-500'}`}>{r.evaluation.status.replace('_', ' ')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
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
      {stage === 'done' && <p className="text-center text-[11px] text-slate-400">AI decision support — not a diagnosis. Please review before acting.</p>}
    </motion.div>
  )
}
