import { useEffect, useState, useRef, useCallback } from "react"
import { Loader2 } from "lucide-react"

interface StreamViewerProps {
  streamUrl: string
}

/**
 * StreamViewer displays an MJPEG stream from the simulator.
 *
 * MJPEG streams work by having the browser automatically update the <img> element
 * as new frames arrive via the multipart/x-mixed-replace response. The browser
 * handles all the frame parsing and display internally.
 *
 * We simply set the img.src to the MJPEG URL and let the browser do the work.
 */
export function StreamViewer({ streamUrl }: StreamViewerProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dimensions, setDimensions] = useState<string>("")

  const imgRef = useRef<HTMLImageElement>(null)

  const log = useCallback((message: string) => {
    console.log(`[StreamViewer] ${message}`)
  }, [])

  useEffect(() => {
    const img = imgRef.current
    if (!img) {
      return
    }

    log(`Setting up MJPEG stream from: ${streamUrl}`)
    setIsLoading(true)
    setError(null)

    const handleLoad = () => {
      log(`Stream started: ${img.naturalWidth}x${img.naturalHeight}`)
      setIsLoading(false)
      setError(null)
      setDimensions(`${img.naturalWidth}x${img.naturalHeight}`)
    }

    const handleError = () => {
      log("Stream error occurred")
      setError("Stream connection lost")
      setIsLoading(false)
    }

    img.addEventListener("load", handleLoad)
    img.addEventListener("error", handleError)

    // Set the stream URL - the browser will automatically update the image
    // as new MJPEG frames arrive
    img.src = streamUrl

    return () => {
      log("Cleaning up stream")
      img.removeEventListener("load", handleLoad)
      img.removeEventListener("error", handleError)
      // Clear the src to close the connection
      img.src = ""
    }
  }, [streamUrl, log])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 text-red-500 p-4">
        <div className="text-sm font-semibold">{error}</div>
        <div className="text-xs">The simulator stream connection was lost</div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full flex flex-col items-center justify-center">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-xl z-10">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="w-8 h-8 animate-spin text-white" />
            <div className="text-white text-sm">Connecting to stream...</div>
          </div>
        </div>
      )}

      {/* MJPEG stream - browser automatically updates this as frames arrive */}
      <img
        ref={imgRef}
        crossOrigin="anonymous"
        className="h-full w-auto object-contain rounded-xl shadow-2xl"
        style={{ maxHeight: "100%", maxWidth: "100%" }}
        alt="Simulator stream"
      />

      {/* Dimensions overlay */}
      {dimensions && (
        <div className="absolute bottom-2 left-2 text-xs text-white/70 bg-black/50 px-2 py-1 rounded">
          {dimensions}
        </div>
      )}
    </div>
  )
}
