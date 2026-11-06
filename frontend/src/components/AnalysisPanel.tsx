import type { Evidence } from '../types'

/** Numbered list of evidence passages (PubMed abstracts or the patient's own documents). */
export function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) return <p className="text-xs text-slate-500">No supporting evidence was retrieved.</p>
  return (
    <ol data-no-translate className="space-y-2">
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
