import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/service-worker.js", { scope: "/" }).then(registration => {
      const notify = () => window.dispatchEvent(new Event("surveytool:offline-ready"))
      notify()
      registration.addEventListener("updatefound", () => registration.installing?.addEventListener("statechange", notify))
    }).catch((error: unknown) => {
      console.warn("SurveyTool app offline shell unavailable:", error)
    })
  })
}
