import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import SimpleApp from './SimpleApp'

function Root() {
  const [mode, setMode] = useState<'simple' | 'advanced'>(() => {
    try { return localStorage.getItem('medlens_view') === 'advanced' ? 'advanced' : 'simple' } catch { return 'simple' }
  })
  const switchTo = (m: 'simple' | 'advanced') => { try { localStorage.setItem('medlens_view', m) } catch { /* ignore */ } setMode(m) }
  return mode === 'simple' ? <SimpleApp onAdvanced={() => switchTo('advanced')} /> : <App onSimple={() => switchTo('simple')} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
