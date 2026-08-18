import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { sanitizeLocalStorage } from './utils/storageSanitizer'

// Sanitize legacy browser cache before mounting React app
sanitizeLocalStorage()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
