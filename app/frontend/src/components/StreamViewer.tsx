import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

interface StreamViewerProps {
  streamUrl: string
}

export function StreamViewer({ streamUrl }: StreamViewerProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setIsLoading(true)
    setError(null)
  }, [streamUrl])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 text-red-500">
        <div className="text-sm font-semibold">{error}</div>
        <div className="text-xs">Check the logs below for details</div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full flex items-center justify-center">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-xl z-10">
          <Loader2 className="w-8 h-8 animate-spin text-white" />
        </div>
      )}
      <img
        src={streamUrl}
        alt="Simulator Stream"
        className="h-full w-auto object-contain rounded-xl shadow-2xl"
        onLoad={() => setIsLoading(false)}
        onError={() => setError("Failed to load simulator stream")}
      />
    </div>
  )
}
