import { useState, useEffect, useRef } from "react"
import { ChevronDown, Apple, Smartphone, FolderOpen } from "lucide-react"
import { api, type ProjectRecord, type Platform } from "@/lib/api"

interface ProjectSelectorProps {
  selectedPath: string | null
  onSelectProject: (project: ProjectRecord) => void
}

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return "Never"

  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return "Just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function PlatformIcon({ platform }: { platform: Platform }) {
  if (platform === "ios") {
    return <Apple className="w-3 h-3" />
  }
  return <Smartphone className="w-3 h-3" />
}

export function ProjectSelector({ selectedPath, onSelectProject }: ProjectSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Find the currently selected project
  const selectedProject = projects.find(p => p.path === selectedPath)

  // Fetch recent projects when dropdown opens
  useEffect(() => {
    if (isOpen) {
      setIsLoading(true)
      api.projects.getRecent({ limit: 10 })
        .then(setProjects)
        .catch(console.error)
        .finally(() => setIsLoading(false))
    }
  }, [isOpen])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [isOpen])

  const handleSelect = (project: ProjectRecord) => {
    onSelectProject(project)
    setIsOpen(false)
  }

  return (
    <div
      ref={dropdownRef}
      className="relative"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-secondary/50 transition-colors"
      >
        {selectedProject ? (
          <>
            <div className="flex items-center gap-1">
              {selectedProject.platforms.map(p => (
                <PlatformIcon key={p} platform={p} />
              ))}
            </div>
            <span className="text-sm font-medium max-w-[200px] truncate">
              {selectedProject.name}
            </span>
          </>
        ) : (
          <>
            <FolderOpen className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Select Project</span>
          </>
        )}
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-[320px] bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="p-2 border-b border-border">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Recent Projects
            </span>
          </div>

          <div className="max-h-[300px] overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Loading...
              </div>
            ) : projects.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                No recent projects
              </div>
            ) : (
              projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => handleSelect(project)}
                  className={`w-full px-3 py-2 flex items-start gap-3 hover:bg-secondary/50 transition-colors text-left ${
                    project.path === selectedPath ? 'bg-secondary/30' : ''
                  }`}
                >
                  <div className="flex items-center gap-1 mt-0.5 shrink-0">
                    {project.platforms.map(p => (
                      <PlatformIcon key={p} platform={p} />
                    ))}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {project.name}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {project.path}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0">
                    {formatRelativeTime(project.last_opened_at)}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
