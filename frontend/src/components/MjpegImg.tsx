import { useEffect, useRef, forwardRef, useImperativeHandle } from "react"

// 1x1 transparent GIF to clear the image source
const NO_IMAGE_DATA =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"

export interface MjpegImgRef {
  getImage: () => HTMLImageElement | null
}

interface MjpegImgProps {
  src: string | null
  className?: string
  onLoad?: () => void
  onError?: () => void
}

/**
 * A component that handles MJPEG stream display with proper connection lifecycle.
 *
 * The primary reason we can't just use an img tag with src directly is that with
 * MJPEG streams, the img element after being removed from the hierarchy will keep
 * the connection open. As a consequence, after several reloads, we will end up
 * maintaining multiple open streams which causes the UI to lag.
 *
 * This component also monitors stream health and auto-reconnects when the stream drops.
 */
export const MjpegImg = forwardRef<MjpegImgRef, MjpegImgProps>(
  ({ src, className, onLoad, onError }, ref) => {
    const imgRef = useRef<HTMLImageElement>(null)

    useImperativeHandle(ref, () => ({
      getImage: () => imgRef.current,
    }))

    // Handle src changes with proper cleanup
    useEffect(() => {
      const img = imgRef.current
      if (!img) return

      // Reset to empty first, then set the real src
      // This ensures the previous connection is closed
      img.src = NO_IMAGE_DATA
      img.src = src || NO_IMAGE_DATA

      return () => {
        // Clean up on unmount - close the MJPEG connection
        img.src = NO_IMAGE_DATA
      }
    }, [src])

    // Stream health monitoring - periodically check if stream is alive
    useEffect(() => {
      if (!src) return

      let cancelled = false
      let timer: ReturnType<typeof setTimeout>

      async function checkStreamHealth() {
        const img = imgRef.current
        if (!img?.src || img.src === NO_IMAGE_DATA) {
          if (!cancelled) {
            timer = setTimeout(checkStreamHealth, 2000)
          }
          return
        }

        try {
          // decode() will reject if the image data is invalid or stream dropped
          await img.decode()
        } catch {
          // Stream connection was dropped - attempt to reconnect
          if (!cancelled && img.src && img.src !== NO_IMAGE_DATA) {
            const srcCopy = img.src
            img.src = NO_IMAGE_DATA
            img.src = srcCopy
            onError?.()
          }
        }

        if (!cancelled) {
          timer = setTimeout(checkStreamHealth, 2000)
        }
      }

      // Start health check after initial load
      timer = setTimeout(checkStreamHealth, 2000)

      return () => {
        cancelled = true
        clearTimeout(timer)
      }
    }, [src, onError])

    return (
      <img
        ref={imgRef}
        className={className}
        onLoad={onLoad}
        onError={onError}
        alt="Simulator stream"
        style={{ display: "none" }} // Hidden - we render to canvas instead
      />
    )
  }
)

MjpegImg.displayName = "MjpegImg"
