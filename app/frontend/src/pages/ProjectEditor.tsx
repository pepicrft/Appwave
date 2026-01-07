import { useState, useEffect, useCallback } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Play, FolderOpen, Loader2, CheckCircle, XCircle, ChevronDown, ChevronUp, Terminal, ArrowLeft } from "lucide-react"
import { StreamViewer } from "@/components/StreamViewer"
import { ProjectSelector } from "@/components/ProjectSelector"
import { api, type BuildEvent, type BuildProduct, type Simulator, type StreamLogEvent, type ProjectRecord } from "@/lib/api"

type BuildState =
  | { status: "idle" }
  | { status: "building"; lines: string[] }
  | { status: "installing" }
  | { status: "streaming"; udid: string }
  | { status: "error"; message: string }
  | { status: "success"; products: BuildProduct[] }

export function ProjectEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [project, setProject] = useState<ProjectRecord | null>(null)
  const [isLoadingProject, setIsLoadingProject] = useState(true)
  const [simulators, setSimulators] = useState<Simulator[]>([])
  const [selectedSimulator, setSelectedSimulator] = useState("")
  const [schemes, setSchemes] = useState<string[]>([])
  const [selectedScheme, setSelectedScheme] = useState("")
  const [buildState, setBuildState] = useState<BuildState>({ status: "idle" })
  const [streamLogs, setStreamLogs] = useState<string[]>([])
  const [showLogs, setShowLogs] = useState(true)

  // Load project by ID
  useEffect(() => {
    if (!id) return

    setIsLoadingProject(true)
    api.projects.getRecent({ limit: 100 })
      .then((projects) => {
        const found = projects.find(p => p.id === parseInt(id))
        if (found) {
          setProject(found)
        } else {
          navigate("/open")
        }
      })
      .catch((err) => {
        console.error("Failed to load project:", err)
        navigate("/open")
      })
      .finally(() => setIsLoadingProject(false))
  }, [id, navigate])

  // Discover schemes for a given path
  const discoverSchemes = useCallback(async (path: string) => {
    if (!path) return

    try {
      const data = await api.xcode.discover({ path })
      setSchemes(data.schemes || [])
      if (data.schemes?.length > 0) {
        setSelectedScheme(data.schemes[0])
      }
    } catch (err) {
      console.error("Failed to discover schemes:", err)
    }
  }, [])

  // Load schemes when project loads
  useEffect(() => {
    if (project?.path) {
      discoverSchemes(project.path)
    }
  }, [project?.path, discoverSchemes])

  // Fetch simulators on mount
  useEffect(() => {
    api.simulator.list()
      .then((simulatorList) => {
        setSimulators(simulatorList)
        const booted = simulatorList.find((s) => s.state === "Booted")
        if (booted) {
          setSelectedSimulator(booted.udid)
        } else if (simulatorList.length > 0) {
          setSelectedSimulator(simulatorList[0].udid)
        }
      })
      .catch((err) => console.error("Failed to fetch simulators:", err))
  }, [])

  // Subscribe to simulator logs when streaming starts
  useEffect(() => {
    if (buildState.status !== "streaming") {
      return
    }

    setStreamLogs([])

    const formatLogEvent = (event: StreamLogEvent): string => {
      const timestamp = new Date().toLocaleTimeString()
      switch (event.type) {
        case "info":
          return `[${timestamp}] INFO: ${event.message}`
        case "error":
          return `[${timestamp}] ERROR: ${event.message}`
        case "debug":
          return `[${timestamp}] DEBUG: ${event.message}`
        case "frame":
          return `[${timestamp}] FRAME: #${event.frameNumber}`
        default:
          return `[${timestamp}] ${JSON.stringify(event)}`
      }
    }

    const unsubscribe = api.simulator.onLog((event) => {
      setStreamLogs((prev) => [...prev.slice(-100), formatLogEvent(event)])
    })

    return () => {
      unsubscribe()
    }
  }, [buildState.status])

  const handleBuildAndRun = async () => {
    if (!project?.path || !selectedScheme || !selectedSimulator) {
      setBuildState({
        status: "error",
        message: "Please select a scheme and simulator",
      })
      return
    }

    setBuildState({ status: "building", lines: [] })

    try {
      const lines: string[] = []

      const buildResult = await new Promise<{ success: boolean; products: BuildProduct[]; buildDir?: string; error?: string }>((resolve) => {
        const unsubscribeBuild = api.xcode.onBuildEvent((event: BuildEvent) => {
          if (event.type === "output" && event.line) {
            console.log("[BUILD]", event.line)
            lines.push(event.line)
            setBuildState({ status: "building", lines: [...lines] })
          } else if (event.type === "started") {
            console.log("[BUILD] Started:", event.scheme)
          } else if (event.type === "completed") {
            console.log("[BUILD] Completed:", event.success ? "SUCCESS" : "FAILED")
            unsubscribeBuild()
            resolve({
              success: event.success ?? false,
              products: event.products || [],
              buildDir: event.buildDir,
            })
          } else if (event.type === "error") {
            console.error("[BUILD] Error:", event.message)
            unsubscribeBuild()
            resolve({
              success: false,
              products: [],
              error: event.message || "Build failed",
            })
          }
        })

        api.xcode.startBuild({
          path: project.path,
          scheme: selectedScheme,
        })
      })

      if (!buildResult.success) {
        setBuildState({
          status: "error",
          message: buildResult.error || "Build failed",
        })
        return
      }

      let buildProducts = buildResult.products

      if (buildProducts.length === 0 && buildResult.buildDir) {
        buildProducts = await api.xcode.getLaunchableProducts({ buildDir: buildResult.buildDir })
      }

      if (buildProducts.length === 0) {
        setBuildState({
          status: "error",
          message: "No build products found",
        })
        return
      }

      setBuildState({ status: "installing" })

      await api.simulator.launch({
        udid: selectedSimulator,
        appPath: buildProducts[0].path,
      })

      await api.simulator.startStream({
        udid: selectedSimulator,
        fps: 60,
        quality: 0.7,
      })

      setBuildState({ status: "streaming", udid: selectedSimulator })
    } catch (err) {
      setBuildState({
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      })
    }
  }

  const getStatusIcon = () => {
    switch (buildState.status) {
      case "building":
      case "installing":
        return <Loader2 className="w-4 h-4 animate-spin" />
      case "streaming":
      case "success":
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case "error":
        return <XCircle className="w-4 h-4 text-red-500" />
      default:
        return <Play className="w-4 h-4" />
    }
  }

  const getStatusText = () => {
    switch (buildState.status) {
      case "building":
        return "Building..."
      case "installing":
        return "Installing..."
      case "streaming":
        return "Running"
      case "success":
        return "Build succeeded"
      case "error":
        return buildState.message
      default:
        return "Build & Run"
    }
  }

  const isLoading = buildState.status === "building" || buildState.status === "installing"

  if (isLoadingProject) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!project) {
    return null
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Title Bar */}
      <header
        className="h-12 shrink-0 flex items-center justify-between pl-20 pr-4 border-b border-border"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/open")}
            className="p-1 rounded hover:bg-secondary/50 transition-colors"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <img
            src="/plasma-icon.png"
            alt="Plasma"
            className="w-6 h-6 rounded"
          />
          <span className="text-sm text-muted-foreground">/</span>
          <ProjectSelector
            selectedPath={project.path}
            onSelectProject={(newProject: ProjectRecord) => {
              navigate(`/project/${newProject.id}`)
            }}
          />
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex gap-6 min-h-0 overflow-hidden p-6">
        {/* Left side - Configuration */}
        <Card className="w-[400px] shrink-0 flex flex-col overflow-hidden">
          <CardHeader className="shrink-0">
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5" />
              Build Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col gap-4 overflow-y-auto">
            {/* Project Info */}
            <div className="flex flex-col gap-1 p-3 bg-secondary/30 rounded-md">
              <span className="text-sm font-medium">{project.name}</span>
              <span className="text-xs text-muted-foreground truncate">{project.path}</span>
            </div>

            {/* Scheme Selector */}
            <div className="flex flex-col gap-2">
              <label className="text-sm text-muted-foreground">Scheme</label>
              <select
                className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                value={selectedScheme}
                onChange={(e) => setSelectedScheme(e.target.value)}
                disabled={schemes.length === 0}
              >
                {schemes.length === 0 ? (
                  <option value="">No schemes found</option>
                ) : (
                  schemes.map((scheme) => (
                    <option key={scheme} value={scheme}>
                      {scheme}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Simulator Selector */}
            <div className="flex flex-col gap-2">
              <label className="text-sm text-muted-foreground">Simulator</label>
              <select
                className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
                value={selectedSimulator}
                onChange={(e) => setSelectedSimulator(e.target.value)}
                disabled={simulators.length === 0}
              >
                {simulators.length === 0 ? (
                  <option value="">No simulators found</option>
                ) : (
                  simulators.map((sim) => (
                    <option key={sim.udid} value={sim.udid}>
                      {sim.name} {sim.state === "Booted" ? "(Booted)" : ""}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Build & Run Button */}
            <Button
              className="w-full mt-2"
              onClick={handleBuildAndRun}
              disabled={isLoading || !selectedScheme}
            >
              {getStatusIcon()}
              <span className="ml-2">{getStatusText()}</span>
            </Button>

            {/* Build Output */}
            {buildState.status === "building" && buildState.lines.length > 0 && (
              <div className="flex flex-col gap-2">
                <label className="text-sm text-muted-foreground">
                  Build Output
                </label>
                <ScrollArea className="h-[200px] rounded-md border p-2 bg-black/20">
                  <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                    {buildState.lines.slice(-50).join("\n")}
                  </pre>
                </ScrollArea>
              </div>
            )}

            {/* Stream Logs */}
            {buildState.status === "streaming" && (
              <div className="flex flex-col gap-2">
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => setShowLogs(!showLogs)}
                >
                  <label className="text-sm text-muted-foreground flex items-center gap-2">
                    <Terminal className="w-4 h-4" />
                    Stream Logs
                    {streamLogs.length > 0 && (
                      <span className="text-xs">({streamLogs.length})</span>
                    )}
                  </label>
                  {showLogs ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
                {showLogs && (
                  <ScrollArea className="h-[150px] rounded-md border p-2 bg-black/20">
                    <pre className="text-xs font-mono whitespace-pre-wrap">
                      {streamLogs.length > 0 ? (
                        streamLogs.map((log, i) => (
                          <div
                            key={i}
                            className={
                              log.includes("ERROR")
                                ? "text-red-400"
                                : log.includes("DEBUG")
                                ? "text-gray-500"
                                : log.includes("FRAME")
                                ? "text-green-400"
                                : "text-muted-foreground"
                            }
                          >
                            {log}
                          </div>
                        ))
                      ) : (
                        <span className="text-muted-foreground">
                          Waiting for logs...
                        </span>
                      )}
                    </pre>
                  </ScrollArea>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right side - Simulator Stream */}
        <div className="flex-1 flex items-center justify-center min-w-0 min-h-0 overflow-hidden bg-black/20 rounded-xl">
          {buildState.status === "streaming" ? (
            <StreamViewer udid={(buildState as { udid: string }).udid} />
          ) : (
            <div className="flex flex-col items-center justify-center gap-4 text-muted-foreground">
              <div className="w-[200px] h-[400px] border-2 border-dashed border-border rounded-3xl flex items-center justify-center">
                <span className="text-sm">Simulator</span>
              </div>
              <p className="text-sm">
                Select a scheme and click "Build & Run" to start
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
