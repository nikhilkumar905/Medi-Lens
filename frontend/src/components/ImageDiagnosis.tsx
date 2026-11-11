import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Bandage, Camera, Eye, ImagePlus, Loader2, Mic, ScanSearch, Sparkles, Volume2, X } from 'lucide-react'
import type { ImageDiagnosis } from '../types'
import { BODY_PART_LABELS } from './AnatomyViewer'
import { ConditionCards } from './SymptomPanel'
import { CareGrid, SeverityMeter, TipCard } from './CareCards'
import { TranslatingNote, useLang, useTranslated } from '../i18n'

const ACCEPT = 'image/jpeg,image/png,image/webp'

/** Upload or capture a photo of a skin problem, wound or injury, add optional notes, then run the prediction. */
export function ImageIntake({ area, busy, onAnalyze, onCamera, captured, onClearCaptured }: {
  area: string | null
  busy: boolean
  onAnalyze: (file: Blob, name: string, notes: string) => void
  onCamera: () => void
  captured?: Blob | null
  onClearCaptured?: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ blob: Blob; name: string } | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [drag, setDrag] = useState(false)
  const { t } = useLang()

  useEffect(() => { if (captured) setFile({ blob: captured, name: `camera_photo_${Date.now()}.jpg` }) }, [captured])
  useEffect(() => {
    if (!file) { setPreview(null); return }
    const u = URL.createObjectURL(file.blob)
    setPreview(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  const pick = (f?: File | null) => { if (f) setFile({ blob: f, name: f.name }) }
  const clear = () => { setFile(null); onClearCaptured?.() }

  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-3xl border border-white/60 bg-white/85 p-5 shadow-lg backdrop-blur">
      <input ref={input} type="file" accept={ACCEPT} hidden onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
      <h3 className="flex items-center gap-2 font-bold text-slate-900"><Bandage size={18} className="text-rose-600" />{t('Photo of a disease or injury')}</h3>
      <p className="mb-3 mt-0.5 text-sm text-slate-500">{t("A rash, skin spot, wound, burn, bite, swelling or injured area. I'll predict what it might be, with symptoms, causes and precautions.")}</p>
      {area && <div className="mb-3"><span className="chip bg-brand-100 text-brand-800">{t('Area: {part}', { part: t(BODY_PART_LABELS[area]) })}</span></div>}

      {!file ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <motion.div onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]) }}
            onClick={() => input.current?.click()} animate={{ scale: drag ? 1.02 : 1 }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition ${drag ? 'border-rose-400 bg-rose-50' : 'border-slate-300 bg-white hover:border-rose-300 hover:bg-rose-50/40'}`}>
            <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 2.4, repeat: Infinity }} className="mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-600"><ImagePlus size={28} /></motion.div>
            <div className="font-semibold text-slate-800">{t('Drop a photo here or click to browse')}</div>
            <div className="mt-1 text-xs text-slate-500">{t('JPG, PNG or WEBP · good light, in focus, close-up')}</div>
          </motion.div>
          <button onClick={onCamera} className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-6 py-5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-amber-300 hover:bg-amber-50">
            <Camera className="text-amber-600" size={26} />{t('Take a photo')}
          </button>
          <p className="flex items-center gap-1.5 text-xs text-slate-500 sm:col-span-2"><Mic size={13} className="shrink-0 text-brand-600" />{t('Or just say “upload image” and choose the photo. I’ll analyse it automatically.')}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
          <div className="relative overflow-hidden rounded-2xl bg-slate-900">
            {preview && <img src={preview} alt="Selected" className="h-48 w-full object-contain" />}
            <button onClick={clear} disabled={busy} className="absolute right-2 top-2 rounded-full bg-white/90 p-1 text-slate-700 shadow hover:bg-white" aria-label="Remove photo"><X size={14} /></button>
          </div>
          <div className="flex flex-col gap-3">
            <textarea className="input min-h-[96px] resize-none" maxLength={800} value={notes} onChange={e => setNotes(e.target.value)}
              placeholder={t('Optional: how long, itching or pain, fever, how it happened (fall, burn, insect bite…)')} />
            <button className="btn-primary !py-2.5" disabled={busy} onClick={() => onAnalyze(file.blob, file.name, notes)}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}{t('Predict condition')}
            </button>
          </div>
        </div>
      )}
      <p className="mt-3 flex items-start gap-1.5 text-[11px] text-slate-400"><AlertTriangle size={12} className="mt-px shrink-0" />{t('The photo is analysed securely and is not stored. Avoid including faces or identifying marks.')}</p>
    </motion.section>
  )
}

/** Friendly card view of a photo prediction, in the selected language. */
export function ImageDiagnosisView({ data: raw, busy, preview, onReadAloud }: {
  data: ImageDiagnosis | null; busy: boolean; preview?: string | null; onReadAloud?: () => void
}) {
  const { t } = useLang()
  const { data, translating, error } = useTranslated(raw)
  if (busy || !data) return (
    <div className="flex flex-col items-center gap-4 py-12 text-slate-500">
      {preview && (
        <div className="relative overflow-hidden rounded-2xl">
          <img src={preview} alt="Analyzing" className="h-44 object-contain opacity-80" />
          <motion.div className="absolute inset-x-0 h-10 bg-gradient-to-b from-transparent via-rose-400/50 to-transparent"
            animate={{ y: [-40, 180, -40] }} transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }} />
        </div>
      )}
      <p className="flex items-center gap-2 text-sm"><ScanSearch size={16} className="text-rose-600" />{t('Studying the photo…')}</p>
    </div>
  )
  const notMedical = !data.is_medical_image
  return (
    <div className="space-y-4">
      <TranslatingNote translating={translating} error={error} />
      <div className="grid gap-4 md:grid-cols-[200px_1fr]">
        {preview && <img src={preview} alt="Analyzed" className="max-h-56 w-full rounded-2xl bg-slate-900 object-contain" />}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-rose-500 to-violet-600 p-5 text-white shadow-md">
          <motion.div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/10" animate={{ scale: [1, 1.25, 1] }} transition={{ duration: 4, repeat: Infinity }} />
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider opacity-90">
            {t('Photo analysis')}
            {data.kind && data.kind !== 'unclear' && <span className="rounded-full bg-white/20 px-2 py-0.5 normal-case tracking-normal">{t(data.kind === 'injury' ? 'Injury' : 'Disease')}</span>}
            <span className="rounded-full bg-white/20 px-2 py-0.5 normal-case tracking-normal">{t('Photo quality')}: {t(data.image_quality)}</span>
          </div>
          {data.possible_conditions[0] && <h2 className="relative mt-1 text-xl font-bold">{data.possible_conditions[0].condition}</h2>}
          <p className="relative mt-1.5 text-[15px] leading-relaxed">{data.spoken_summary}</p>
          {onReadAloud && <button onClick={onReadAloud} className="relative mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-medium hover:bg-white/30"><Volume2 size={13} />{t('Read aloud')}</button>}
        </motion.div>
      </div>

      {data.quality_issue && <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{data.quality_issue}</div>}

      {!notMedical && <>
        <SeverityMeter level={data.severity} reason={data.severity_reason} title={t('How serious is it?')} />
        <TipCard title={t('What I see in the photo')} items={data.observations} tone="info" />
        {!!data.possible_conditions.length && (
          <section>
            <h3 className="mb-2 text-sm font-bold text-slate-800">{t('Possible conditions (prediction, not a diagnosis)')}</h3>
            <ConditionCards items={data.possible_conditions} />
          </section>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <TipCard title={t('Possible symptoms')} items={data.symptoms} tone="life" />
          <TipCard title={t('Home care / first aid')} items={data.home_care} tone="do" delay={0.05} />
        </div>
        <CareGrid causes={data.causes} precautions={data.precautions} avoid={data.avoid} prevention={data.prevention} seeDoctor={data.see_doctor_if} />
        <TipCard title={t('Tests a doctor may do')} items={data.recommended_tests} tone="info" delay={0.3} />
      </>}
      <p className="flex items-center justify-center gap-1 text-center text-[11px] text-slate-400"><Eye size={11} />{data.limitations.join(' ')}</p>
    </div>
  )
}
