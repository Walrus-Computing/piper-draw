import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startHeartbeat } from './utils/analytics.ts'
import { initAnalyticsBridge } from './stores/analyticsBridge.ts'

startHeartbeat()
initAnalyticsBridge()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
