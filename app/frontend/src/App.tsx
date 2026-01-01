import { useEffect } from "react"
import { BuildAndRun } from "@/components/BuildAndRun"
import { checkForUpdates } from "@/lib/updater"

function App() {
  // Check for updates on app startup (only in Electron environment)
  useEffect(() => {
    // Only run updater in Electron environment, not in tests or browser
    if (typeof window !== 'undefined' && 'electron' in window) {
      checkForUpdates()
    }
  }, [])

  return <BuildAndRun />
}

export default App
