import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, BookOpen, Check, Download, FileDown, GitCompare, Loader2, Pencil, RefreshCw, Sparkles, X, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import type { CompareResult } from '../services/api'
import type { Analysis, BBox, Evidence, LabRow } from '../types'
import { ConditionCards } from './SymptomPanel'

const STATUS_STYLE: Record<string, string> = {
  high: 'bg-rose-100 text-rose-700', low: 'bg-sky-100 text-sky-700', normal: 'bg-emerald-100 text-emerald-700',
}

interface Props {
  analysis: Analysis
  compare: CompareResult | null
  busy: string | null
  onInterpret: (q?: string) => void
  onCompare: () => void
  onSave: (body: { rows?: Partial<LabRow>[]; doctor_notes?: string; review_status?: string }) => void
  onReanalyze: () => void
  onGenerate: () => void
  onDownload: (reportId: number) => void
  onRowSelect: (h: { page: number; bbox: BBox } | null) => void
}

export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) return <p className="text-xs text-slate-500">No supporting evidence was retrieved.</p>
  return (
    <ol className="space-y-2">
      {evidence.map(e => (
        <li key={e.id} className="rounded-lg border border-slate-200 p-2 text-xs">
          <div className="flex items-start gap-2">
            <span className="chip bg-brand-100 text-brand-700">{e.id}</span>
            <div className="min-w-0">
              {e.source_type === 'pubmed' ? (
                <>
                  <a href={e.meta?.url} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline">{e.title}</a>
                  <div className="text-slate-500">
                    {(e.meta?.authors || []).slice(0, 3).join(', ')}{(e.meta?.authors?.length || 0) > 3 ? ' et al.' : ''} · {e.meta?.journal} {e.meta?.year} · PMID {e.source_id}
                    {e.meta?.doi && <> · doi:{e.meta.doi}</>}
                  </div>
                </>
              ) : <div className="font-medium">Patient document: {e.title} (page {e.page})</div>}
              <details className="mt-1 text-slate-600"><summary className="cursor-pointer text-slate-400">passage</summary>{e.text}</details>
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

export default function AnalysisPanel(p: Props) {
  const a = p.analysis
  const s = a.structured
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState<LabRow[]>(s.rows)
  const [notes, setNotes] = useState(a.doctor_notes || '')
  const [question, setQuestion] = useState('')
  useEffect(() => { setRows(s.rows); setNotes(a.doctor_notes || ''); setEditing(false) }, [a.id, a.updated_at, s.rows, a.doctor_notes])
  const it = a.interpretation
  const abnormal = s.rows.filter(r => ['high', 'low'].includes(r.evaluation.status))
  const latestReport = a.reports[a.reports.length - 1]

  const setRow = (i: number, k: keyof LabRow, v: string) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, [k]: v || null } : r)))

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">Document type</div>
          <div className="text-lg font-semibold text-slate-900">{s.report_type}</div>
          <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
            <span className="chip bg-slate-100 text-slate-600">{s.structuring_method}</span>
            {s.model && <span className="chip bg-slate-100 text-slate-600">{s.model}</span>}
            <span className={`chip ${a.review_status === 'approved' ? 'bg-emerald-100 text-emerald-700' : a.review_status === 'rejected' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'}`}>
              Review: {a.review_status}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs">
          {(['patient_name', 'age', 'gender', 'report_date', 'laboratory_name'] as const).map(k => (
            <div key={k} className="contents">
              <span className="text-slate-400">{k.replace('_', ' ')}</span>
              <span className={s.patient[k] ? 'text-slate-700' : 'italic text-slate-400'}>{s.patient[k] || 'not in source'}</span>
            </div>
          ))}
        </div>
      </div>

      {it?.spoken_summary && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 p-4 text-white">
          <div className="text-xs uppercase tracking-wide opacity-80">What this report shows</div>
          <p className="mt-1 leading-relaxed">{it.spoken_summary}</p>
        </motion.div>
      )}

      {s.warnings.map((w, i) => <div key={i} className="flex gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{w}</div>)}

      {/* findings */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Extracted findings <span className="font-normal text-slate-400">({s.rows.length} values, {abnormal.length} outside reference)</span></h3>
          {editing ? (
            <div className="flex gap-1.5">
              <button className="btn-ghost !py-1 !text-xs" onClick={() => { setRows(s.rows); setEditing(false) }}><X size={13} />Discard</button>
              <button className="btn-primary !py-1 !text-xs" onClick={() => { p.onSave({ rows }); setEditing(false) }}><Check size={13} />Save corrections</button>
            </div>
          ) : <button className="btn-ghost !py-1 !text-xs" onClick={() => setEditing(true)}><Pencil size={13} />Edit / correct</button>}
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-3 py-2">Test</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">Unit</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Pg</th></tr>
            </thead>
            <tbody>
              {(editing ? rows : s.rows).map((r, i) => (
                <tr key={i} className={`border-t border-slate-100 ${['high', 'low'].includes(r.evaluation.status) ? 'bg-rose-50/40' : ''} hover:bg-amber-50`}
                  onMouseEnter={() => r.bbox && p.onRowSelect({ page: r.page, bbox: r.bbox })} onMouseLeave={() => p.onRowSelect(null)}>
                  {editing ? (
                    (['test_name', 'result', 'unit', 'reference_interval'] as const).map(k => (
                      <td key={k} className="px-1.5 py-1"><input className="input !px-2 !py-1" value={(r[k] as string) || ''} onChange={e => setRow(i, k, e.target.value)} /></td>
                    ))
                  ) : (
                    <>
                      <td className="px-3 py-1.5 font-medium">{r.test_name}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono">{r.result}{r.flag && <span className="ml-1 text-rose-600">{r.flag}</span>}
                        {r.verification === 'Requires manual verification' && <span className="ml-1 text-amber-600" title="Requires manual verification">⚠</span>}
                        {r.verification === 'doctor-edited' && <Pencil size={11} className="ml-1 inline text-slate-400" />}</td>
                      <td className="px-3 py-1.5 text-slate-600">{r.unit || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-slate-600">{r.reference_interval || '—'}</td>
                    </>
                  )}
                  <td className="px-3 py-1.5"><span className={`chip ${STATUS_STYLE[r.evaluation.status] || 'bg-slate-100 text-slate-500'}`} title={r.evaluation.note}>{r.evaluation.status.replace('_', ' ')}</span></td>
                  <td className="px-3 py-1.5 text-xs text-slate-400">{r.page}</td>
                </tr>
              ))}
              {!s.rows.length && <tr><td colSpan={6} className="px-3 py-4 text-center text-sm text-slate-500">No structured lab values were found. Review the extracted content or edit manually.</td></tr>}
            </tbody>
          </table>
        </div>
        {editing && <button className="btn-ghost mt-2 !py-1 !text-xs" onClick={() => setRows(rs => [...rs, { test_name: '', result: '', unit: null, reference_interval: null, flag: null, evaluation: { status: 'no_reference', note: '' }, page: 1, line_index: 0, bbox: null, verification: 'doctor-edited', source_line: null }])}>+ Add row</button>}
        <p className="mt-1.5 text-[11px] text-slate-400">Status compares results only against the reference interval printed on the report. ⚠ = requires manual verification. An abnormal value is not a diagnosis.</p>
        {s.observations.length > 0 && <div className="mt-2 text-xs text-slate-600"><b>Report remarks:</b> {s.observations.join(' · ')}</div>}
      </section>

      {/* interpretation */}
      <section className="rounded-xl border border-slate-200 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles size={15} className="text-brand-600" />AI interpretation (RAG: PubMed + prior records)</h3>
          <form className="flex gap-1.5" onSubmit={e => { e.preventDefault(); p.onInterpret(question || undefined) }}>
            <input className="input !w-64 !py-1 !text-xs" placeholder="Optional question…" value={question} onChange={e => setQuestion(e.target.value)} />
            <button className="btn-primary !py-1 !text-xs" disabled={p.busy === 'interpret'}>{p.busy === 'interpret' ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}{it ? 'Re-run' : 'Explain findings'}</button>
          </form>
        </div>
        {!it && p.busy !== 'interpret' && <p className="text-xs text-slate-500">Retrieves relevant PubMed abstracts and the patient’s earlier documents, then asks the Groq LLM for a cited explanation.</p>}
        {p.busy === 'interpret' && <p className="text-xs text-slate-500">Retrieving evidence and generating interpretation…</p>}
        {it && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3 text-sm">
            {it.summary && <p className="text-slate-700">{it.summary}</p>}
            {!!it.abnormal_findings?.length && (
              <div><div className="mb-1 text-xs font-semibold uppercase text-slate-400">Model-generated findings</div>
                <ul className="space-y-1">{it.abnormal_findings.map((f, i) => <li key={i}><b>{f.test}:</b> {f.explanation} {f.evidence.map(e => <sup key={e} className="text-brand-600">[{e}]</sup>)}</li>)}</ul></div>
            )}
            {it.interpretation && <div><div className="mb-1 text-xs font-semibold uppercase text-slate-400">Clinical interpretation</div><p>{it.interpretation}</p></div>}
            {!!it.differential_considerations?.length && (
              <div><div className="mb-1 text-xs font-semibold uppercase text-slate-400">Possible conditions</div>
                <ConditionCards items={it.differential_considerations} /></div>
            )}
            {!!it.suggested_further_evaluation?.length && (
              <div><div className="mb-1 text-xs font-semibold uppercase text-slate-400">Suggested further evaluation</div>
                <ul className="list-disc pl-5">{it.suggested_further_evaluation.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            )}
            <div className="rounded-lg bg-slate-50 p-2 text-xs text-slate-500"><b>Limitations:</b> {it.limitations?.join(' ')}</div>
            <details><summary className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-slate-600"><BookOpen size={13} />Supporting evidence ({it.evidence?.length || 0})</summary>
              <div className="mt-2"><EvidenceList evidence={it.evidence || []} /></div></details>
            <div className="text-[11px] text-slate-400">{it.model} · {it.generated_at && new Date(it.generated_at).toLocaleString()}</div>
          </motion.div>
        )}
      </section>

      {/* compare */}
      <section className="rounded-xl border border-slate-200 p-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold"><GitCompare size={15} className="text-brand-600" />Previous-report comparison</h3>
          <button className="btn-ghost !py-1 !text-xs" onClick={p.onCompare} disabled={p.busy === 'compare'}>{p.busy === 'compare' && <Loader2 size={13} className="animate-spin" />}Compare</button>
        </div>
        {p.compare && !p.compare.available && <p className="mt-2 text-xs text-slate-500">{p.compare.message}</p>}
        {p.compare?.available && (
          <div className="mt-2 overflow-x-auto">
            {!p.compare.comparisons?.length && <p className="text-xs text-slate-500">Previous reports found ({p.compare.previous_count}) but no matching tests.</p>}
            <table className="w-full text-xs">
              <tbody>
                {p.compare.comparisons?.map((c, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3 font-medium">{c.test_name}</td>
                    <td className="py-1.5">{c.points.map((pt, j) => (
                      <span key={j} className={`mr-2 inline-block rounded px-1.5 py-0.5 ${pt.current ? 'bg-brand-100 text-brand-800' : 'bg-slate-100'}`} title={pt.document}>
                        {pt.date}: <b>{pt.result}</b> {pt.unit}</span>))}</td>
                    <td className="py-1.5 text-right">{c.trend === 'increased' ? <TrendingUp size={14} className="inline text-rose-500" /> : c.trend === 'decreased' ? <TrendingDown size={14} className="inline text-sky-500" /> : c.trend ? <Minus size={14} className="inline" /> : <span className="text-slate-400">{c.note || '—'}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* review */}
      <section className="rounded-xl border-2 border-brand-100 bg-brand-50/40 p-3">
        <h3 className="mb-2 text-sm font-semibold">Doctor review & approval</h3>
        <textarea className="input min-h-[64px]" placeholder="Doctor notes / conclusions (included in the report)…" value={notes} onChange={e => setNotes(e.target.value)} />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button className="btn-primary" onClick={() => p.onSave({ doctor_notes: notes, review_status: 'approved' })}><Check size={15} />Approve</button>
          <button className="btn-ghost" onClick={() => p.onSave({ doctor_notes: notes, review_status: 'rejected' })}><X size={15} />Reject</button>
          <button className="btn-ghost" onClick={p.onReanalyze} disabled={p.busy === 'analyze'}><RefreshCw size={15} />Re-analyze</button>
          <div className="flex-1" />
          <button className="btn-primary" disabled={a.review_status !== 'approved' || p.busy === 'report'} onClick={p.onGenerate}
            title={a.review_status !== 'approved' ? 'Approve the analysis first' : ''}>
            {p.busy === 'report' ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} />}Generate PDF
          </button>
          {latestReport && <button className="btn-ghost" onClick={() => p.onDownload(latestReport.id)}><Download size={15} />Download v{latestReport.version}</button>}
        </div>
        {a.review_status !== 'approved' && <p className="mt-1.5 text-[11px] text-slate-500">PDF generation is enabled only after approval. Editing values after approval resets the status to pending.</p>}
      </section>
    </div>
  )
}
