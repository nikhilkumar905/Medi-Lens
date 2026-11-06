import { useState } from 'react'
import { UserPlus, Users, ShieldCheck, ShieldAlert } from 'lucide-react'
import { api } from '../services/api'
import type { Patient } from '../types'
import { Modal } from './Overlays'

interface Props { patients: Patient[]; current: Patient | null; onSelect: (p: Patient | null) => void; onChanged: () => void }

export default function PatientBar({ patients, current, onSelect, onChanged }: Props) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', age: '', gender: '', mrn: '', consent_ai_processing: false })
  const [err, setErr] = useState<string | null>(null)

  const toggleConsent = async () => {
    if (!current) return
    const updated = await api.updatePatient(current.id, { ...current, consent_ai_processing: !current.consent_ai_processing })
    onSelect(updated); onChanged()
  }

  return (
    <div className="flex items-center gap-2">
      <Users size={16} className="text-slate-400" />
      <select className="input !w-56 !py-1.5" value={current?.id || ''}
        onChange={e => onSelect(patients.find(p => p.id === Number(e.target.value)) || null)}>
        <option value="">No patient (unlinked)</option>
        {patients.map(p => <option key={p.id} value={p.id}>{p.name}{p.mrn ? ` · ${p.mrn}` : ''}</option>)}
      </select>
      {current && (
        <button onClick={toggleConsent} title="Toggle consent for AI processing"
          className={`chip ${current.consent_ai_processing ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
          {current.consent_ai_processing ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
          {current.consent_ai_processing ? 'AI consent' : 'No AI consent'}
        </button>
      )}
      <button className="btn-ghost !py-1.5" onClick={() => setOpen(true)}><UserPlus size={15} /> New</button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <h3 className="mb-3 font-semibold">New patient record</h3>
          <div className="grid grid-cols-2 gap-2">
            <input className="input col-span-2" placeholder="Full name *" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <input className="input" placeholder="Age" value={form.age} onChange={e => setForm({ ...form, age: e.target.value })} />
            <select className="input" value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}>
              <option value="">Gender</option><option>Female</option><option>Male</option><option>Other</option>
            </select>
            <input className="input col-span-2" placeholder="MRN / ID" value={form.mrn} onChange={e => setForm({ ...form, mrn: e.target.value })} />
            <label className="col-span-2 flex items-start gap-2 text-xs text-slate-600">
              <input type="checkbox" className="mt-0.5" checked={form.consent_ai_processing} onChange={e => setForm({ ...form, consent_ai_processing: e.target.checked })} />
              Patient consents to AI-assisted processing (de-identified text is sent to the configured LLM provider).
            </label>
          </div>
          {err && <p className="mt-2 text-sm text-rose-600">{err}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary" disabled={!form.name.trim()} onClick={async () => {
              try { const p = await api.createPatient(form); onChanged(); onSelect(p); setOpen(false); setForm({ name: '', age: '', gender: '', mrn: '', consent_ai_processing: false }) }
              catch (e) { setErr((e as Error).message) }
            }}>Create</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
