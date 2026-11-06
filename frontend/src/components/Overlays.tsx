import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Camera, X, Stethoscope, Loader2 } from 'lucide-react'
import { api, auth } from '../services/api'
import { LanguageSwitch, useLang } from '../i18n'

export function Modal({ children, onClose, wide }: { children: React.ReactNode; onClose?: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className={`card w-full ${wide ? 'max-w-3xl' : 'max-w-md'} p-5`} onClick={e => e.stopPropagation()}>
        {children}
      </motion.div>
    </div>
  )
}

export function ConfirmDialog({ title, message, onConfirm, onCancel }: { title: string; message: string; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useLang()
  return (
    <Modal onClose={onCancel}>
      <h3 className="text-base font-semibold">{t(title)}</h3>
      <p className="mt-2 text-sm text-slate-600">{t(message)}</p>
      <p className="mt-1 text-xs text-slate-400">{t('You can also say “yes” or “no”.')}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onCancel}>{t('Cancel')}</button>
        <button className="btn-primary" onClick={onConfirm} autoFocus>{t('Confirm')}</button>
      </div>
    </Modal>
  )
}

export interface CameraHandle { capture: () => void }

export const CameraCapture = forwardRef<CameraHandle, { onCapture: (b: Blob) => void; onClose: () => void }>(
  function CameraCapture({ onCapture, onClose }, ref) {
    const video = useRef<HTMLVideoElement>(null)
    const [err, setErr] = useState<string | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    useEffect(() => {
      navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } })
        .then(s => { streamRef.current = s; if (video.current) video.current.srcObject = s })
        .catch(e => setErr((e as DOMException).name === 'NotAllowedError'
          ? 'Camera permission denied. Allow camera access in the browser address bar and reopen the camera.'
          : `Camera unavailable: ${(e as Error).message}`))
      return () => streamRef.current?.getTracks().forEach(t => t.stop())
    }, [])
    const capture = () => {
      const v = video.current
      if (!v || !v.videoWidth) return
      const c = document.createElement('canvas')
      c.width = v.videoWidth
      c.height = v.videoHeight
      c.getContext('2d')!.drawImage(v, 0, 0)
      c.toBlob(b => b && onCapture(b), 'image/jpeg', 0.95)
    }
    useImperativeHandle(ref, () => ({ capture }))
    const { t } = useLang()
    return (
      <Modal onClose={onClose} wide>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">{t('Camera')}</h3>
          <button className="btn-ghost !p-1.5" onClick={onClose}><X size={16} /></button>
        </div>
        {err ? <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{err}</div> :
          <video ref={video} autoPlay playsInline muted className="aspect-video w-full rounded-xl bg-black object-contain" />}
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-slate-500">{t('Keep it steady and well lit. Say “capture” when ready.')}</p>
          <button className="btn-primary" onClick={capture} disabled={!!err}><Camera size={16} /> {t('Capture')}</button>
        </div>
      </Modal>
    )
  })

export function Login({ onLogin }: { onLogin: (doctor: string) => void }) {
  const [u, setU] = useState('doctor')
  const [p, setP] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { t } = useLang()
  return (
    <div className="relative flex min-h-full items-center justify-center bg-gradient-to-br from-brand-900 via-brand-700 to-brand-500 p-4">
      <motion.form initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="card w-full max-w-sm p-7"
        onSubmit={async e => {
          e.preventDefault(); setBusy(true); setErr(null)
          try { const r = await api.login(u, p); auth.set(r.token); onLogin(r.doctor) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
        }}>
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white"><Stethoscope /></div>
          <div><h1 translate="no" className="text-xl font-bold text-slate-900">MedLens</h1><p className="text-xs text-slate-500">{t('Voice-first medical assistant')}</p></div>
        </div>
        <div className="mb-4 flex justify-center"><LanguageSwitch /></div>
        <label className="text-xs font-medium text-slate-600">{t('Username')}</label>
        <input className="input mb-3 mt-1" value={u} onChange={e => setU(e.target.value)} autoComplete="username" />
        <label className="text-xs font-medium text-slate-600">{t('Password')}</label>
        <input className="input mt-1" type="password" value={p} onChange={e => setP(e.target.value)} autoComplete="current-password" autoFocus />
        {err && <p className="mt-3 text-sm text-rose-600">{err}</p>}
        <button className="btn-primary mt-5 w-full" disabled={busy}>{busy && <Loader2 size={16} className="animate-spin" />} {t('Sign in')}</button>
        <p className="mt-4 text-[11px] leading-relaxed text-slate-400">{t('Decision-support tool. Not a certified medical device. Use synthetic data unless your hospital has approved this environment.')}</p>
      </motion.form>
    </div>
  )
}
