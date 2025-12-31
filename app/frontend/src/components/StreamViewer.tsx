import { useEffect, useState, useRef, useCallback } from "react"
import { Loader2 } from "lucide-react"

interface StreamViewerProps {
  streamUrl: string
}

const NO_IMAGE_DATA =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><rect width='100%' height='100%' fill='black'/></svg>"

export function StreamViewer({ streamUrl }: StreamViewerProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [frameCount, setFrameCount] = useState(0)
  const [debugInfo, setDebugInfo] = useState<string>("")

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const isRunningRef = useRef(false)
  const frameCountRef = useRef(0)

  const log = useCallback((message: string) => {
    console.log(`[StreamViewer] ${message}`)
    setDebugInfo(prev => {
      const lines = prev.split('\n').slice(-10) // Keep last 10 lines
      return [...lines, `${new Date().toLocaleTimeString()}: ${message}`].join('\n')
    })
  }, [])

  // Draw image to canvas
  const drawToCanvas = useCallback((img: HTMLImageElement) => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const ctx = canvas.getContext("2d")
    if (!ctx) {
      return
    }

    // Check if image has valid dimensions
    if (img.naturalWidth === 0 || img.naturalHeight === 0) {
      return
    }

    // Update canvas dimensions if needed
    if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      log(`Canvas resized to ${img.naturalWidth}x${img.naturalHeight}`)
    }

    // Draw the image
    ctx.drawImage(img, 0, 0)
    frameCountRef.current++

    // Update frame count every 30 frames
    if (frameCountRef.current % 30 === 0) {
      setFrameCount(frameCountRef.current)
    }
  }, [log])

  // Main rendering loop
  useEffect(() => {
    const img = imgRef.current
    const canvas = canvasRef.current

    if (!img || !canvas) {
      log("Missing img or canvas ref")
      return
    }

    log(`Setting up stream from: ${streamUrl}`)
    setIsLoading(true)
    setError(null)
    frameCountRef.current = 0
    setFrameCount(0)

    let animationId: number | null = null

    const updateFrame = () => {
      if (isRunningRef.current && imgRef.current) {
        drawToCanvas(imgRef.current)
        animationId = requestAnimationFrame(updateFrame)
      }
    }

    const handleLoad = () => {
      log(`Image loaded: ${img.naturalWidth}x${img.naturalHeight}`)
      setIsLoading(false)
      setError(null)

      if (!isRunningRef.current) {
        isRunningRef.current = true
        log("Starting render loop")
        requestAnimationFrame(updateFrame)
      }
    }

    const handleError = (e: Event) => {
      log(`Image error: ${e.type}`)

      // Try to reconnect by resetting src
      if (img.src !== NO_IMAGE_DATA && isRunningRef.current) {
        log("Attempting to reconnect...")
        const srcCopy = img.src
        img.src = NO_IMAGE_DATA
        setTimeout(() => {
          if (imgRef.current) {
            imgRef.current.src = srcCopy
          }
        }, 100)
      } else {
        setError("Stream connection lost")
      }
    }

    // Set up event listeners
    img.addEventListener("load", handleLoad)
    img.addEventListener("error", handleError)

    // Reset and set new source
    img.src = NO_IMAGE_DATA
    log("Setting img.src to stream URL")
    img.src = streamUrl

    // Periodic health check using img.decode()
    let healthCheckTimer: ReturnType<typeof setInterval> | null = null

    const checkStreamHealth = async () => {
      if (!imgRef.current?.src || imgRef.current.src === NO_IMAGE_DATA) {
        return
      }

      try {
        await imgRef.current.decode()
      } catch {
        log("Stream health check failed, reconnecting...")
        if (imgRef.current && isRunningRef.current) {
          const srcCopy = imgRef.current.src
          imgRef.current.src = NO_IMAGE_DATA
          imgRef.current.src = srcCopy
        }
      }
    }

    healthCheckTimer = setInterval(checkStreamHealth, 2000)

    return () => {
      log("Cleaning up stream")
      isRunningRef.current = false

      if (animationId) {
        cancelAnimationFrame(animationId)
      }

      if (healthCheckTimer) {
        clearInterval(healthCheckTimer)
      }

      img.removeEventListener("load", handleLoad)
      img.removeEventListener("error", handleError)

      // Reset src to close the MJPEG connection
      img.src = NO_IMAGE_DATA
    }
  }, [streamUrl, drawToCanvas, log])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 text-red-500 p-4">
        <div className="text-sm font-semibold">{error}</div>
        <div className="text-xs">Check the logs below for details</div>
        <pre className="text-xs text-gray-500 bg-black/20 p-2 rounded max-w-full overflow-auto">
          {debugInfo}
        </pre>
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

      {/* Hidden img element that receives the MJPEG stream */}
      <img
        ref={imgRef}
        crossOrigin="anonymous"
        style={{ display: "none" }}
        alt=""
      />

      {/* Canvas that displays the frames */}
      <canvas
        ref={canvasRef}
        className="h-full w-auto object-contain rounded-xl shadow-2xl"
        style={{ maxHeight: "100%", maxWidth: "100%" }}
      />

      {/* Debug info overlay */}
      <div className="absolute bottom-2 left-2 text-xs text-white/70 bg-black/50 px-2 py-1 rounded">
        Frames: {frameCount}
      </div>

      {/* Debug log (only in development) */}
      {debugInfo && (
        <div className="absolute top-2 right-2 max-w-xs">
          <details className="text-xs">
            <summary className="text-white/70 bg-black/50 px-2 py-1 rounded cursor-pointer">
              Debug Log
            </summary>
            <pre className="text-white/50 bg-black/70 p-2 rounded mt-1 max-h-40 overflow-auto whitespace-pre-wrap">
              {debugInfo}
            </pre>
          </details>
        </div>
      )}
    </div>
  )
}
