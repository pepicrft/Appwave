import { useEffect } from "react"
import { BuildAndRun } from "@/components/BuildAndRun"
import { checkForUpdates } from "@/lib/updater"

function App() {
  // Check for updates on app startup (only in Tauri environment)
  useEffect(() => {
    // Only run updater in Tauri environment, not in tests or browser
    if (typeof window !== 'undefined' && '__TAURI__' in window) {
      checkForUpdates()
    }
  }, [])

  return <BuildAndRun />
}

export default App
