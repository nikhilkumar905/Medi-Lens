import { useState } from 'react'
import { motion } from 'framer-motion'
import { Upload, Camera, ShieldAlert, ShieldCheck, Cpu, Loader2, BookOpen } from 'lucide-react'
import { api } from '../services/api'
import type { Doc, RouteDecision, UploadKind } from '../types'
import { BODY_PART_LABELS } from './AnatomyViewer'
import { useAuthedImage } from './ExtractionViewer'

export const RECOMMENDED: Record<string, UploadKind[]> = {
  brain: ['mri', 'ct', 'report'], skull: ['xray', 'ct'], eyes: ['photo', 'report'], ears: ['report'], nose: ['xray', 'ct'],
  mouth: ['photo', 'xray'], jaw: ['xray', 'ct'], neck: ['ultrasound', 'ct', 'mri'], heart: ['report', 'xray', 'ct', 'mri'],
  lungs: ['xray', 'ct', 'report'], chest: ['xray', 'ct'], shoulders: ['xray', 'mri'], liver: ['ultrasound', 'ct', 'report'],
  stomach: ['report', 'ct'], pancreas: ['ct', 'mri', 'report'], kidneys: ['ultrasound', 'ct', 'report'],
  gallbladder: ['ultrasound', 'report'], spleen: ['ct', 'ultrasound'], small_intestine: ['ct', 'report'],
  large_intestine: ['ct', 'report'], pelvis: ['xray', 'ct', 'mri'], bladder: ['ultrasound', 'report'],
  reproductive: ['ultrasound', 'report'], spine: ['xray', 'mri', 'ct'], ribs: ['xray', 'ct'], arms: ['xray'],
  legs: ['xray', 'mri'], knees: ['xray', 'mri'], feet: ['xray'], skin: ['photo'],
}

export const KIND_LABEL: Record<UploadKind, string> = {
  report: 'Medical report', xray: 'X-ray', ct: 'CT scan', mri: 'MRI', ultrasound: 'Ultrasound', photo: 'Clinical photo', previous: 'Previous report',
}

function DicomViewer({ doc }: { doc: Doc }) {
  const meta = doc.extraction?.dicom || {}
  const frames = Number(meta.frames || 1)
  const [frame, setFrame] = useState(0)
  const wc0 = Array.isArray(meta.WindowCenter) ? Number(meta.WindowCenter[0]) : meta.WindowCenter !== undefined ? Number(meta.WindowCenter) : undefined
  const ww0 = Array.isArray(meta.WindowWidth) ? Number(meta.WindowWidth[0]) : meta.WindowWidth !== undefined ? Number(meta.WindowWidth) : undefined
  const [wc, setWc] = useState<number | undefined>(wc0)
  const [ww, setWw] = useState<number | undefined>(ww0)
  const { url, err } = useAuthedImage(() => api.dicomFrame(doc.id, frame, wc, ww), [doc.id, frame, wc, ww])
  const presets = [{ n: 'Default', c: wc0, w: ww0 }, { n: 'Lung', c: -600, w: 1500 }, { n: 'Soft tissue', c: 40, w: 400 }, { n: 'Bone', c: 400, w: 1800 }, { n: 'Brain', c: 40, w: 80 }]
  return (
    <div className="grid gap-3 md:grid-cols-[1fr_220px]">
      <div className="flex min-h-[300px] items-center justify-center rounded-xl bg-black">
        {err ? <p className="p-4 text-sm text-rose-300">{err}</p> : url ? <img src={url} className="max-h-[460px] object-contain" alt="DICOM frame" /> : <Loader2 className="animate-spin text-white" />}
      </div>
      <div className="space-y-2 text-xs">
        {frames > 1 && (<label className="block">Slice {frame + 1}/{frames}<input type="range" min={0} max={frames - 1} value={frame} onChange={e => setFrame(Number(e.target.value))} className="w-full" /></label>)}
        <div className="flex flex-wrap gap-1">{presets.map(p => <button key={p.n} className="btn-ghost !px-2 !py-1 !text-[11px]" onClick={() => { setWc(p.c); setWw(p.w) }}>{p.n}</button>)}</div>
        <div className="max-h-56 overflow-auto rounded-lg bg-slate-50 p-2 scroll-thin">
          {Object.entries(meta).filter(([k]) => !k.endsWith('UID')).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2 border-b border-slate-100 py-0.5"><span className="text-slate-400">{k}</span><span className="truncate text-right">{Array.isArray(v) ? v.map(x => typeof x === 'number' ? Math.round(x * 100) / 100 : x).join(', ') : String(v)}</span></div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface Props {
  part: string
  doc: Doc | null
  kind: UploadKind
  route: RouteDecision | null
  busy: string | null
  onUpload: (k: UploadKind) => void
  onCamera: () => void
  onRoute: () => void
  onLearn: () => void
}

export default function BodyInvestigation({ part, doc, kind, route, busy, onUpload, onCamera, onRoute, onLearn }: Props) {
  const recs = RECOMMENDED[part] || ['report']
  const { url } = useAuthedImage(doc && doc.content_type.startsWith('image/') ? () => api.pageImage(doc.id, 1) : null, [doc?.id])
  return (
    <div className="space-y-4">
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 p-4 text-white">
        <div className="text-xs uppercase tracking-wide opacity-80">Investigating</div>
        <div className="text-2xl font-semibold">{BODY_PART_LABELS[part]}</div>
        <p className="mt-1 text-sm opacity-90">Provide a relevant scan or report. Each modality needs a compatible, validated model — unsupported tasks are declined, never guessed.</p>
      </motion.div>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Recommended inputs</div>
        <div className="flex flex-wrap gap-2">
          {recs.map(k => <button key={k} className="btn-ghost" onClick={() => onUpload(k)}><Upload size={15} />Upload {KIND_LABEL[k]}</button>)}
          <button className="btn-ghost" onClick={onCamera}><Camera size={15} />Capture photo</button>
          <button className="btn-ghost" onClick={onLearn} disabled={busy === 'ask'}>{busy === 'ask' ? <Loader2 size={15} className="animate-spin" /> : <BookOpen size={15} />}Learn about the {BODY_PART_LABELS[part].toLowerCase()}</button>
        </div>
      </div>

      {doc && (
        <div className="space-y-3 rounded-xl border border-slate-200 p-3">
          <div className="flex items-center justify-between text-sm">
            <span><b>{doc.filename}</b> <span className="text-slate-400">· declared as {KIND_LABEL[kind]}</span></span>
            <button className="btn-primary !py-1.5" onClick={onRoute} disabled={busy === 'route'}>{busy === 'route' ? <Loader2 size={14} className="animate-spin" /> : <Cpu size={14} />}Analyze image</button>
          </div>
          {doc.content_type === 'application/dicom' && <DicomViewer doc={doc} />}
          {url && <img src={url} alt="uploaded" className="max-h-[420px] rounded-lg object-contain" />}
        </div>
      )}

      {route && (
        <div className={`rounded-xl border p-3 text-sm ${route.supported ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          <div className="flex items-center gap-2 font-semibold">{route.supported ? <ShieldCheck size={16} className="text-emerald-600" /> : <ShieldAlert size={16} className="text-amber-600" />}
            {route.supported ? `Routed to ${route.name || route.model}` : 'Unsupported task — no AI findings generated'}</div>
          <p className="mt-1 text-slate-700">{route.message || route.task}</p>
          {route.candidate && <p className="mt-1 text-xs text-slate-500">Candidate model (not configured): {route.candidate.name} — {route.candidate.task}. <a className="underline" href={route.candidate.source} target="_blank" rel="noreferrer">Model card</a></p>}
          <p className="mt-1 text-xs text-slate-500">{route.validation || 'Clinical validation data not available.'}</p>
        </div>
      )}
    </div>
  )
}
