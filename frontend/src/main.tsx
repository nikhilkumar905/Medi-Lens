import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import SimpleApp from './SimpleApp'
import { LangProvider, LanguagePicker, languageChosen } from './i18n'

function Root() {
  // ask for the language every time the app is opened (once per browser tab session)
  const [picked, setPicked] = useState(languageChosen)
  if (!picked) return <LanguagePicker onDone={() => setPicked(true)} />
  return <SimpleApp />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider><Root /></LangProvider>
  </StrictMode>,
)
