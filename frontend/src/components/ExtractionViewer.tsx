import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, FileText, ScanLine } from 'lucide-react'
import { api } from '../services/api'
import type { BBox, Doc } from '../types'

export function useAuthedImage(loader: (() => Promise<Blob>) | null, deps: unknown[]) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!loader) { setUrl(null); return }
    let revoked = false
    let u: string | null = null
    setErr(null)
    loader().then(b => { if (!revoked) { u = URL.createObjectURL(b); setUrl(u) } }).catch(e => setErr((e as Error).message))
    return () => { revoked = true; if (u) URL.revokeObjectURL(u) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { url, err }
}

interface Props { doc: Doc; highlight: { page: number; bbox: BBox } | null; onHighlight: (h: { page: number; bbox: BBox } | null) => void }

export default function ExtractionViewer({ doc, highlight, onHighlight }: Props) {
  const pages = doc.extraction?.pages || []
  const [page, setPage] = useState(1)
  useEffect(() => { if (highlight) setPage(highlight.page) }, [highlight])
  const hasVisual = doc.content_type === 'application/pdf' || doc.content_type.startsWith('image/')
  const { url, err } = useAuthedImage(hasVisual ? () => api.pageImage(doc.id, page) : null, [doc.id, page])
  const cur = pages.find(p => p.page === page)
  const box = highlight && highlight.page === page ? highlight.bbox : null

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-3 lg:grid-cols-2">
      <section className="flex min-h-0 flex-col rounded-xl border border-slate-200">
        <header className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Original document</span>
          {pages.length > 1 && (
            <span className="flex items-center gap-1 normal-case">
              <button className="btn-ghost !p-1" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={14} /></button>
              Page {page} / {pages.length}
              <button className="btn-ghost !p-1" disabled={page >= pages.length} onClick={() => setPage(page + 1)}><ChevronRight size={14} /></button>
            </span>
          )}
        </header>
        <div className="relative flex-1 overflow-auto scroll-thin bg-slate-50 p-2">
          {!hasVisual && <div className="p-6 text-center text-sm text-slate-500"><FileText className="mx-auto mb-2" />No visual preview for {doc.filename.split('.').pop()?.toUpperCase()} files — see extracted content.</div>}
          {err && <div className="p-4 text-sm text-rose-600">{err}</div>}
          {url && (
            <div className="relative mx-auto w-full max-w-2xl">
              <img src={url} alt={`Page ${page}`} className="w-full rounded shadow" />
              {box && (
                <div className="pointer-events-none absolute rounded border-2 border-amber-500 bg-amber-300/30 transition-all"
                  style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${(box[2] - box[0]) * 100}%`, height: `${(box[3] - box[1]) * 100}%` }} />
              )}
            </div>
          )}
        </div>
      </section>

      <section className="flex min-h-0 flex-col rounded-xl border border-slate-200">
        <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-xs">
          <span className="font-semibold uppercase tracking-wide text-slate-500">Extracted content</span>
          {cur && <span className={`chip ${cur.method.startsWith('ocr') ? 'bg-violet-100 text-violet-700' : cur.method === 'native' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}><ScanLine size={11} />{cur.method}</span>}
          {cur?.quality && <span className="chip bg-slate-100 text-slate-600">text quality {Math.round(cur.quality.score * 100)}%</span>}
        </header>
        <div className="flex-1 overflow-auto scroll-thin p-3">
          {doc.extraction?.error && <div className="mb-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-700">{doc.extraction.error}</div>}
          {cur?.warnings.map((w, i) => <div key={i} className="mb-2 flex gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{w}</div>)}
          {cur?.quality?.issues.map((w, i) => <div key={`q${i}`} className="mb-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">Quality check: {w}</div>)}
          {cur && cur.lines.length === 0 && <p className="text-sm text-slate-500">No readable text on this page.</p>}
          <div className="font-mono text-[12.5px] leading-relaxed">
            {cur?.lines.map((ln, i) => (
              <div key={i} onMouseEnter={() => ln.bbox && onHighlight({ page, bbox: ln.bbox })} onMouseLeave={() => onHighlight(null)}
                className={`flex cursor-default gap-3 rounded px-1 hover:bg-amber-50 ${ln.low_confidence ? 'text-amber-700' : ''}`}>
                {ln.cells.map((c, j) => <span key={j} className={j === 0 ? 'min-w-[38%]' : ''}>{c.text}</span>)}
                {ln.low_confidence && <span title="Low OCR confidence – requires manual verification">⚠</span>}
              </div>
            ))}
          </div>
          {cur && <div className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-400">Page {cur.page} · {cur.lines.length} lines</div>}
        </div>
      </section>
    </div>
  )
}
