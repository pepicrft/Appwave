import { useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import { GetStarted } from "@/components/GetStarted"
import { MainLayout } from "@/components/MainLayout"
import { checkForUpdates } from "@/lib/updater"

function App() {
  const [searchParams] = useSearchParams()
  const projectPath = searchParams.get("project")

  // Check for updates on app startup
  useEffect(() => {
    checkForUpdates()
  }, [])

  if (!projectPath) {
    return <GetStarted />
  }

  return <MainLayout projectPath={projectPath} />
}

export default App
