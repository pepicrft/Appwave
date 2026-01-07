import { useEffect } from "react"
import { Routes, Route, Navigate } from "react-router-dom"
import { OpenProject } from "@/pages/OpenProject"
import { ProjectEditor } from "@/pages/ProjectEditor"
import { checkForUpdates } from "@/lib/updater"

function App() {
  // Check for updates on app startup (only in Electron environment)
  useEffect(() => {
    if (typeof window !== 'undefined' && 'electron' in window) {
      checkForUpdates()
    }
  }, [])

  return (
    <Routes>
      <Route path="/open" element={<OpenProject />} />
      <Route path="/project/:id" element={<ProjectEditor />} />
      <Route path="/" element={<Navigate to="/open" replace />} />
    </Routes>
  )
}

export default App
