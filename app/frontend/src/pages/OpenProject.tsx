import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Apple, Smartphone, FolderOpen, Clock, CheckCircle2, XCircle } from "lucide-react"
import { api } from "@/lib/api"
import type { UnifiedProject } from "@/lib/api"

export function OpenProject() {
  const navigate = useNavigate()

  // Form state
  const [projectName, setProjectName] = useState("")
  const [xcodeProjectPath, setXcodeProjectPath] = useState("")
  const [androidProjectPath, setAndroidProjectPath] = useState("")
  const [isCreating, setIsCreating] = useState(false)

  // Validation state
  const [xcodeValidation, setXcodeValidation] = useState<{ valid: boolean; error?: string } | null>(null)
  const [xcodeValidating, setXcodeValidating] = useState(false)
  const [androidValidation, setAndroidValidation] = useState<{ valid: boolean; error?: string } | null>(null)
  const [androidValidating, setAndroidValidating] = useState(false)

  // Recent projects
  const [recentProjects, setRecentProjects] = useState<UnifiedProject[]>([])

  // Load recent projects on mount
  useEffect(() => {
    api.projects.getRecentUnified(5).then(setRecentProjects).catch(console.error)
  }, [])

  // Validate Xcode path when it changes
  useEffect(() => {
    if (!xcodeProjectPath.trim()) {
      setXcodeValidation(null)
      setXcodeValidating(false)
      return
    }

    setXcodeValidating(true)
    const timer = setTimeout(async () => {
      try {
        const result = await api.projects.validateXcode(xcodeProjectPath.trim())
        setXcodeValidation({ valid: result.valid, error: result.error })
      } catch {
        setXcodeValidation({ valid: false, error: "Failed to validate path" })
      } finally {
        setXcodeValidating(false)
      }
    }, 500)

    return () => {
      clearTimeout(timer)
      setXcodeValidating(false)
    }
  }, [xcodeProjectPath])

  // Validate Android path when it changes
  useEffect(() => {
    if (!androidProjectPath.trim()) {
      setAndroidValidation(null)
      setAndroidValidating(false)
      return
    }

    setAndroidValidating(true)
    const timer = setTimeout(async () => {
      try {
        const result = await api.projects.validateAndroid(androidProjectPath.trim())
        setAndroidValidation({ valid: result.valid, error: result.error })
      } catch {
        setAndroidValidation({ valid: false, error: "Failed to validate path" })
      } finally {
        setAndroidValidating(false)
      }
    }, 500)

    return () => {
      clearTimeout(timer)
      setAndroidValidating(false)
    }
  }, [androidProjectPath])

  const handleCreateProject = async () => {
    if (!projectName.trim()) {
      return
    }

    // Must have at least one valid project
    const hasValidXcode = xcodeProjectPath.trim() && xcodeValidation?.valid
    const hasValidAndroid = androidProjectPath.trim() && androidValidation?.valid

    if (!hasValidXcode && !hasValidAndroid) {
      return
    }

    setIsCreating(true)

    try {
      const result = await api.projects.create({
        name: projectName.trim(),
        xcodePath: xcodeProjectPath.trim() || undefined,
        androidPath: androidProjectPath.trim() || undefined,
      })

      if (result.project) {
        navigate(`/project/${result.project.id}`)
      }
    } catch (err) {
      console.error("Failed to create project:", err)
    } finally {
      setIsCreating(false)
    }
  }

  const handleBrowseXcode = async () => {
    const result = await api.showOpenDialog({
      properties: ['openFile', 'openDirectory'],
    })
    if (!result.canceled && result.filePaths.length > 0) {
      setXcodeProjectPath(result.filePaths[0])
    }
  }

  const handleBrowseAndroid = async () => {
    const result = await api.showOpenDialog({
      properties: ['openDirectory'],
    })
    if (!result.canceled && result.filePaths.length > 0) {
      setAndroidProjectPath(result.filePaths[0])
    }
  }

  const handleOpenRecentProject = (project: UnifiedProject) => {
    navigate(`/project/${project.id}`)
  }

  // Check if we have at least one valid project path
  const hasValidXcode = xcodeProjectPath.trim() && xcodeValidation?.valid
  const hasValidAndroid = androidProjectPath.trim() && androidValidation?.valid
  const hasAtLeastOneProject = hasValidXcode || hasValidAndroid

  const canCreate = projectName.trim() && hasAtLeastOneProject

  const ValidationIcon = ({ validation, validating }: { validation: { valid: boolean; error?: string } | null, validating: boolean }) => {
    if (validating) {
      return <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
    }
    if (validation?.valid) {
      return <CheckCircle2 className="h-4 w-4 text-green-500" />
    }
    if (validation && !validation.valid) {
      return <XCircle className="h-4 w-4 text-destructive" />
    }
    return null
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Title Bar */}
      <header
        className="h-12 shrink-0 flex items-center pl-20 pr-4 border-b"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-3">
          <img
            src="/plasma-icon.png"
            alt="Plasma"
            className="w-6 h-6 rounded"
          />
          <span className="text-sm font-medium text-muted-foreground">Plasma</span>
        </div>
      </header>

      {/* Main content */}
      <div
        className="flex-1 flex flex-col items-center justify-center p-6 gap-6 overflow-auto"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Open Project</CardTitle>
            <CardDescription>
              Configure your mobile app project. At least one platform is required.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6">
            {/* Project Name */}
            <div className="grid gap-2">
              <Label htmlFor="project-name">Project Name</Label>
              <Input
                id="project-name"
                type="text"
                placeholder="My App"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </div>

            {/* Xcode Project */}
            <div className="grid gap-2">
              <Label htmlFor="xcode-path" className="flex items-center gap-2">
                <Apple className="h-4 w-4" />
                Xcode Project
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="xcode-path"
                    type="text"
                    placeholder="/path/to/Project.xcodeproj"
                    value={xcodeProjectPath}
                    onChange={(e) => setXcodeProjectPath(e.target.value)}
                    className="pr-8"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <ValidationIcon validation={xcodeValidation} validating={xcodeValidating} />
                  </div>
                </div>
                <Button variant="outline" size="icon" onClick={handleBrowseXcode}>
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
              {xcodeValidation && !xcodeValidation.valid && xcodeValidation.error && (
                <p className="text-sm text-destructive">{xcodeValidation.error}</p>
              )}
              {!xcodeValidation && (
                <p className="text-sm text-muted-foreground">
                  Select an .xcodeproj, .xcworkspace, or directory containing one
                </p>
              )}
            </div>

            {/* Android Project */}
            <div className="grid gap-2">
              <Label htmlFor="android-path" className="flex items-center gap-2">
                <Smartphone className="h-4 w-4" />
                Android Project
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="android-path"
                    type="text"
                    placeholder="/path/to/android-project"
                    value={androidProjectPath}
                    onChange={(e) => setAndroidProjectPath(e.target.value)}
                    className="pr-8"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <ValidationIcon validation={androidValidation} validating={androidValidating} />
                  </div>
                </div>
                <Button variant="outline" size="icon" onClick={handleBrowseAndroid}>
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
              {androidValidation && !androidValidation.valid && androidValidation.error && (
                <p className="text-sm text-destructive">{androidValidation.error}</p>
              )}
              {!androidValidation && (
                <p className="text-sm text-muted-foreground">
                  Select a directory containing build.gradle or build.gradle.kts
                </p>
              )}
            </div>
          </CardContent>
          <CardFooter>
            <Button
              className="w-full"
              onClick={handleCreateProject}
              disabled={isCreating || !canCreate}
            >
              {isCreating ? "Opening..." : "Open Project"}
            </Button>
          </CardFooter>
        </Card>

        {/* Recent Projects */}
        {recentProjects.length > 0 && (
          <div className="w-full max-w-md">
            <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Recent Projects
            </h3>
            <div className="space-y-2">
              {recentProjects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => handleOpenRecentProject(project)}
                  className="w-full text-left p-3 rounded-lg border bg-card hover:bg-accent transition-colors"
                >
                  <div className="font-medium">{project.name}</div>
                  <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                    {project.xcode_path && (
                      <span className="flex items-center gap-1">
                        <Apple className="h-3 w-3" /> iOS
                      </span>
                    )}
                    {project.android_path && (
                      <span className="flex items-center gap-1">
                        <Smartphone className="h-3 w-3" /> Android
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
