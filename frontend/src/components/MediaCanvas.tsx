import { useEffect, useRef, forwardRef, useCallback } from "react"
import { MjpegImg } from "./MjpegImg"
import type { MjpegImgRef } from "./MjpegImg"

interface MediaCanvasProps {
  src: string | null
  className?: string
  onStreamStart?: () => void
  onStreamError?: () => void
}

/**
 * A canvas-based renderer for MJPEG streams that uses requestAnimationFrame
 * for smooth 60fps playback.
 *
 * The canvas approach provides:
 * 1. Smooth rendering via requestAnimationFrame
 * 2. Easy rotation/transformation support
 * 3. Better control over frame timing
 * 4. Ability to add overlays or effects
 */
export const MediaCanvas = forwardRef<HTMLCanvasElement, MediaCanvasProps>(
  ({ src, className, onStreamStart, onStreamError }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const mjpegRef = useRef<MjpegImgRef>(null)
    const isRunningRef = useRef(false)
    const hasStartedRef = useRef(false)
    const lastDimensionsRef = useRef({ width: 0, height: 0 })

    // Forward the canvas ref
    useEffect(() => {
      if (ref && typeof ref === "object") {
        ref.current = canvasRef.current
      }
    }, [ref])

    // Draw frame to canvas
    const drawFrame = useCallback(() => {
      const canvas = canvasRef.current
      const img = mjpegRef.current?.getImage()

      if (!canvas || !img) return

      const ctx = canvas.getContext("2d")
      if (!ctx) return

      // Get natural dimensions of the image
      const sourceWidth = img.naturalWidth
      const sourceHeight = img.naturalHeight

      // Skip if image hasn't loaded yet
      if (sourceWidth === 0 || sourceHeight === 0) return

      // Only resize canvas if dimensions changed
      if (
        lastDimensionsRef.current.width !== sourceWidth ||
        lastDimensionsRef.current.height !== sourceHeight
      ) {
        canvas.width = sourceWidth
        canvas.height = sourceHeight
        lastDimensionsRef.current = { width: sourceWidth, height: sourceHeight }
      }

      // Draw the image to canvas
      ctx.drawImage(img, 0, 0, sourceWidth, sourceHeight)

      // Notify on first successful frame
      if (!hasStartedRef.current) {
        hasStartedRef.current = true
        onStreamStart?.()
      }
    }, [onStreamStart])

    // Animation loop using requestAnimationFrame
    useEffect(() => {
      if (!src) {
        isRunningRef.current = false
        hasStartedRef.current = false
        return
      }

      isRunningRef.current = true
      let animationId: number

      const animate = () => {
        if (isRunningRef.current) {
          drawFrame()
          animationId = requestAnimationFrame(animate)
        }
      }

      // Start the animation loop
      animationId = requestAnimationFrame(animate)

      return () => {
        isRunningRef.current = false
        cancelAnimationFrame(animationId)
      }
    }, [src, drawFrame])

    // Reset state when src changes
    useEffect(() => {
      hasStartedRef.current = false
      lastDimensionsRef.current = { width: 0, height: 0 }
    }, [src])

    const handleError = useCallback(() => {
      onStreamError?.()
    }, [onStreamError])

    return (
      <>
        {/* Hidden img element that receives the MJPEG stream */}
        <MjpegImg ref={mjpegRef} src={src} onError={handleError} />

        {/* Visible canvas that renders the frames */}
        <canvas ref={canvasRef} className={className} />
      </>
    )
  }
)

MediaCanvas.displayName = "MediaCanvas"
