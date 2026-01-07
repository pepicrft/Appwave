import { useState, useEffect, useRef, useMemo } from "react"
import { useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { FolderOpen } from "lucide-react"
import { api } from "@/lib/api"

function getPlatformProjectTypes(): string {
  const platform = navigator.platform.toLowerCase()
  const isMacOS = platform.includes("mac")

  if (isMacOS) {
    return "Xcode or Android"
  }
  return "Android"
}

interface RecentProject {
  path: string
  name: string
}

export function GetStarted() {
  const [, setSearchParams] = useSearchParams()
  const [path, setPath] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<RecentProject[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)
  const projectTypes = useMemo(() => getPlatformProjectTypes(), [])

  // Fetch recent projects on mount and when typing
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const projects = await api.projects.getRecent({
          query: path || undefined,
          limit: 10,
        })
        setSuggestions(projects)
      } catch {
        setSuggestions([])
      }
    }

    const debounce = setTimeout(fetchProjects, 150)
    return () => clearTimeout(debounce)
  }, [path])

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)
    setShowSuggestions(false)

    try {
      const result = await api.projects.validate({ path })

      if (result.error) {
        setError(result.error)
        return
      }

      if (result.project?.valid && result.project.path) {
        // Use the resolved project file path, not the input directory
        setSearchParams({ project: result.project.path })
      } else {
        setError("Invalid project directory")
      }
    } catch {
      setError("Failed to validate project. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSelectProject = (project: RecentProject) => {
    setPath(project.path)
    setShowSuggestions(false)
    setSelectedIndex(-1)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setSelectedIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : prev
        )
        break
      case "ArrowUp":
        e.preventDefault()
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1))
        break
      case "Enter":
        if (selectedIndex >= 0) {
          e.preventDefault()
          handleSelectProject(suggestions[selectedIndex])
        }
        break
      case "Escape":
        setShowSuggestions(false)
        setSelectedIndex(-1)
        break
    }
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <img
              src="/plasma-icon.png"
              alt="Plasma"
              className="w-16 h-16"
            />
          </div>
          <CardTitle className="text-2xl">Welcome to Plasma</CardTitle>
          <CardDescription>
            Enter the path to your {projectTypes} project to get started
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2 relative">
              <Input
                ref={inputRef}
                type="text"
                placeholder="/path/to/your/project"
                value={path}
                onChange={(e) => {
                  setPath(e.target.value)
                  setShowSuggestions(true)
                  setSelectedIndex(-1)
                }}
                onFocus={() => setShowSuggestions(true)}
                onKeyDown={handleKeyDown}
                aria-label="Project path"
                disabled={isLoading}
                autoComplete="off"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div
                  ref={suggestionsRef}
                  className="absolute z-10 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-60 overflow-auto"
                >
                  {suggestions.map((project, index) => (
                    <button
                      key={project.path}
                      type="button"
                      className={`w-full px-3 py-2 text-left hover:bg-accent transition-colors ${
                        index === selectedIndex ? "bg-accent" : ""
                      }`}
                      onClick={() => handleSelectProject(project)}
                    >
                      <div className="font-medium text-sm">{project.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {project.path}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={!path.trim() || isLoading}
            >
              <FolderOpen className="w-4 h-4 mr-2" />
              {isLoading ? "Validating..." : "Open Project"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
