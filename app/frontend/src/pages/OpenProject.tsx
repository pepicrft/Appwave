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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Apple, Smartphone, FolderOpen, Clock, Plus, FolderSearch, CheckCircle2, XCircle } from "lucide-react"
import { api } from "@/lib/api"
import type { UnifiedProject } from "@/lib/api"

export function OpenProject() {
  const navigate = useNavigate()

  // Form state for existing projects
  const [xcodeProjectPath, setXcodeProjectPath] = useState("")
  const [androidProjectPath, setAndroidProjectPath] = useState("")
  const [isCreating, setIsCreating] = useState(false)

  // Form state for new project
  const [newProjectName, setNewProjectName] = useState("")
  const [newProjectDirectory, setNewProjectDirectory] = useState("")

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

  const handleCreateNewProject = async () => {
    if (!newProjectName.trim() || !newProjectDirectory.trim()) {
      return
    }

    setIsCreating(true)

    try {
      const result = await api.projects.create({
        name: newProjectName.trim(),
        directory: newProjectDirectory.trim(),
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

  const handleBrowseNewProjectDirectory = async () => {
    const result = await api.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    })
    if (!result.canceled && result.filePaths.length > 0) {
      setNewProjectDirectory(result.filePaths[0])
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

  const handleOpenExistingProject = async () => {
    // Must have at least one valid project
    const hasValidXcode = xcodeProjectPath.trim() && xcodeValidation?.valid
    const hasValidAndroid = androidProjectPath.trim() && androidValidation?.valid

    if (!hasValidXcode && !hasValidAndroid) {
      return
    }

    // Auto-generate project name from the first valid path
    const pathToUse = xcodeProjectPath.trim() || androidProjectPath.trim()
    const generatedName = pathToUse.split('/').pop()?.replace(/\.(xcodeproj|xcworkspace)$/, '') || 'Untitled Project'

    setIsCreating(true)

    try {
      const result = await api.projects.create({
        name: generatedName,
        xcodePath: xcodeProjectPath.trim() || undefined,
        androidPath: androidProjectPath.trim() || undefined,
      })

      if (result.project) {
        navigate(`/project/${result.project.id}`)
      }
    } catch (err) {
      console.error("Failed to open project:", err)
    } finally {
      setIsCreating(false)
    }
  }

  // Check if we have at least one valid project path (for existing tab)
  const hasValidXcode = xcodeProjectPath.trim() && xcodeValidation?.valid
  const hasValidAndroid = androidProjectPath.trim() && androidValidation?.valid
  const hasAtLeastOneProject = hasValidXcode || hasValidAndroid

  // Check if new project form is valid
  const canCreateNew = newProjectName.trim() && newProjectDirectory.trim()

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
        className="flex-1 flex flex-col items-center p-6 pt-12 overflow-auto"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Card className="w-full max-w-md">
          <Tabs defaultValue={recentProjects.length > 0 ? "recent" : "new"}>
            <CardHeader className="pb-4">
              <CardTitle className="text-2xl text-center mb-4">Open Project</CardTitle>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="recent" className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4" />
                  Recent
                </TabsTrigger>
                <TabsTrigger value="existing" className="flex items-center gap-1.5">
                  <FolderSearch className="h-4 w-4" />
                  Existing
                </TabsTrigger>
                <TabsTrigger value="new" className="flex items-center gap-1.5">
                  <Plus className="h-4 w-4" />
                  New
                </TabsTrigger>
              </TabsList>
            </CardHeader>

            {/* Recent Projects Tab */}
            <TabsContent value="recent" className="mt-0">
              <CardContent>
                {recentProjects.length > 0 ? (
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
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Clock className="h-12 w-12 mx-auto mb-3 opacity-50" />
                    <p>No recent projects</p>
                    <p className="text-sm mt-1">Create a new project to get started</p>
                  </div>
                )}
              </CardContent>
            </TabsContent>

            {/* Existing Project Tab */}
            <TabsContent value="existing" className="mt-0">
              <CardContent className="grid gap-4">
                <CardDescription>
                  Open an existing Xcode or Android project from your file system.
                </CardDescription>

                {/* Xcode Project */}
                <div className="grid gap-2">
                  <Label htmlFor="existing-xcode-path" className="flex items-center gap-2">
                    <Apple className="h-4 w-4" />
                    Xcode Project
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        id="existing-xcode-path"
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
                    <p className="text-sm text-destructive mt-1">{xcodeValidation.error}</p>
                  )}
                  {!xcodeValidation && (
                    <p className="text-sm text-muted-foreground mt-1">
                      Select an .xcodeproj, .xcworkspace, or directory containing one
                    </p>
                  )}
                </div>

                {/* Android Project */}
                <div className="grid gap-2">
                  <Label htmlFor="existing-android-path" className="flex items-center gap-2">
                    <Smartphone className="h-4 w-4" />
                    Android Project
                    <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        id="existing-android-path"
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
                    <p className="text-sm text-destructive mt-1">{androidValidation.error}</p>
                  )}
                  {!androidValidation && (
                    <p className="text-sm text-muted-foreground mt-1">
                      Select a directory containing build.gradle or build.gradle.kts
                    </p>
                  )}
                </div>
              </CardContent>
              <CardFooter className="pt-2">
                <Button
                  className="w-full"
                  onClick={handleOpenExistingProject}
                  disabled={isCreating || !hasAtLeastOneProject}
                >
                  {isCreating ? "Opening..." : "Open Project"}
                </Button>
              </CardFooter>
            </TabsContent>

            {/* New Project Tab */}
            <TabsContent value="new" className="mt-0">
              <CardContent className="grid gap-4">
                <CardDescription>
                  Create a new project in an empty directory.
                </CardDescription>

                {/* Project Name */}
                <div className="grid gap-2">
                  <Label htmlFor="new-project-name">Project Name</Label>
                  <Input
                    id="new-project-name"
                    type="text"
                    placeholder="My App"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                  />
                </div>

                {/* Directory */}
                <div className="grid gap-2">
                  <Label htmlFor="new-project-directory" className="flex items-center gap-2">
                    <FolderOpen className="h-4 w-4" />
                    Directory
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="new-project-directory"
                      type="text"
                      placeholder="/path/to/directory"
                      value={newProjectDirectory}
                      onChange={(e) => setNewProjectDirectory(e.target.value)}
                    />
                    <Button variant="outline" size="icon" onClick={handleBrowseNewProjectDirectory}>
                      <FolderSearch className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Select an empty directory where the project will be created
                  </p>
                </div>
              </CardContent>
              <CardFooter className="pt-2">
                <Button
                  className="w-full"
                  onClick={handleCreateNewProject}
                  disabled={isCreating || !canCreateNew}
                >
                  {isCreating ? "Creating..." : "Create Project"}
                </Button>
              </CardFooter>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  )
}
