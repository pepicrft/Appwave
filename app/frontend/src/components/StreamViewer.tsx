import { useEffect, useRef, useState, useCallback, type MouseEvent } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";

interface StreamViewerProps {
  udid: string;
}

interface TouchPoint {
  x: number;
  y: number;
}

/**
 * StreamViewer displays frames from the simulator via IPC.
 *
 * Frames are received as base64-encoded JPEGs via IPC events.
 * Touch events are sent via IPC to the main process.
 */
export function StreamViewer({ udid }: StreamViewerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [dimensions, setDimensions] = useState("");
  const [isPressing, setIsPressing] = useState(false);
  const [touchPoint, setTouchPoint] = useState<TouchPoint | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const frameCountRef = useRef(0);
  const dragStartRef = useRef<TouchPoint | null>(null);

  // Send touch event to backend (began, moved, ended)
  const sendTouch = useCallback(
    async (point: TouchPoint, touchType: "began" | "moved" | "ended") => {
      try {
        // Fire-and-forget for move events to avoid blocking
        api.simulator.touch({
          udid,
          type: touchType,
          touches: [{ x: point.x, y: point.y }],
        }).catch((err) => {
          console.error("[StreamViewer] Failed to send touch:", err);
        });
      } catch (err) {
        console.error("[StreamViewer] Failed to send touch:", err);
      }
    },
    [udid]
  );

  // Get normalized touch coordinates (0-1 range) from mouse event
  const getNormalizedCoordinates = useCallback(
    (e: MouseEvent<HTMLDivElement>): TouchPoint => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0.5, y: 0.5 };

      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      return { x, y };
    },
    []
  );

  // Threshold for distinguishing tap vs drag (in normalized coordinates)
  const DRAG_THRESHOLD = 0.02; // 2% of screen size

  // Check if movement exceeds drag threshold
  const isDragMovement = useCallback(
    (start: TouchPoint, current: TouchPoint): boolean => {
      const dx = Math.abs(current.x - start.x);
      const dy = Math.abs(current.y - start.y);
      return dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD;
    },
    []
  );

  // Mouse event handlers - send continuous touch events for real-time feedback
  const handleMouseDown = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      const point = getNormalizedCoordinates(e);
      setIsPressing(true);
      setTouchPoint(point);
      setIsDragging(false);
      dragStartRef.current = point;
      // Send touch began immediately
      sendTouch(point, "began");
    },
    [getNormalizedCoordinates, sendTouch]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!isPressing) return;
      e.preventDefault();
      const point = getNormalizedCoordinates(e);
      setTouchPoint(point);

      // Check if we've started dragging
      if (!isDragging && dragStartRef.current) {
        if (isDragMovement(dragStartRef.current, point)) {
          setIsDragging(true);
        }
      }

      // Send move event for continuous feedback
      if (isDragging || (dragStartRef.current && isDragMovement(dragStartRef.current, point))) {
        sendTouch(point, "moved");
      }
    },
    [isPressing, isDragging, getNormalizedCoordinates, isDragMovement, sendTouch]
  );

  const handleMouseUp = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!isPressing) return;
      e.preventDefault();
      const point = getNormalizedCoordinates(e);

      // Send touch ended - HID touch Up completes the tap/drag
      sendTouch(point, "ended");

      setIsPressing(false);
      setTouchPoint(null);
      setIsDragging(false);
      dragStartRef.current = null;
    },
    [isPressing, getNormalizedCoordinates, sendTouch]
  );

  const handleMouseLeave = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!isPressing) return;
      e.preventDefault();
      const point = getNormalizedCoordinates(e);

      // Send touch ended when leaving the area
      sendTouch(point, "ended");

      setIsPressing(false);
      setTouchPoint(null);
      setIsDragging(false);
      dragStartRef.current = null;
    },
    [isPressing, getNormalizedCoordinates, sendTouch]
  );

  // Subscribe to frame events from IPC
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      console.log("[StreamViewer] Missing canvas ref");
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.log("[StreamViewer] No canvas context");
      return;
    }

    console.log("[StreamViewer] Setting up IPC stream for UDID:", udid);

    // Create an image element to decode base64 frames
    const img = new Image();

    const unsubscribe = api.simulator.onStreamFrame((frame) => {
      // Only process frames for this UDID
      if (frame.udid !== udid) return;

      // Decode base64 frame
      img.onload = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;

        if (w === 0 || h === 0) return;

        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          setDimensions(`${w}x${h}`);
          console.log("[StreamViewer] Canvas resized to:", w, "x", h);
        }

        ctx.drawImage(img, 0, 0);
        setIsLoading(false);

        frameCountRef.current++;
        if (frameCountRef.current % 60 === 0) {
          console.log("[StreamViewer] Drew frame", frameCountRef.current);
        }
      };

      img.src = `data:image/jpeg;base64,${frame.frame}`;
    });

    return () => {
      console.log("[StreamViewer] Cleanup");
      unsubscribe();
    };
  }, [udid]);

  // Calculate touch indicator position relative to canvas
  const getTouchIndicatorStyle = useCallback(() => {
    if (!touchPoint || !canvasRef.current || !wrapperRef.current) return null;

    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    const canvasRect = canvas.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();

    // Calculate canvas position relative to wrapper
    const canvasLeft = canvasRect.left - wrapperRect.left;
    const canvasTop = canvasRect.top - wrapperRect.top;

    // Calculate absolute position within wrapper
    const left = canvasLeft + touchPoint.x * canvasRect.width;
    const top = canvasTop + touchPoint.y * canvasRect.height;

    return {
      position: "absolute" as const,
      left: `${left}px`,
      top: `${top}px`,
      width: isPressing ? "40px" : "30px",
      height: isPressing ? "40px" : "30px",
      borderRadius: "50%",
      backgroundColor: isPressing
        ? "rgba(59, 130, 246, 0.5)"
        : "rgba(59, 130, 246, 0.3)",
      border: "2px solid rgba(59, 130, 246, 0.8)",
      transform: "translate(-50%, -50%)",
      pointerEvents: "none" as const,
      transition: "width 0.1s, height 0.1s, background-color 0.1s",
    };
  }, [touchPoint, isPressing]);

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full flex items-center justify-center overflow-hidden"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      style={{ cursor: "pointer" }}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-xl z-10">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="w-8 h-8 animate-spin text-white" />
            <div className="text-white text-sm">Connecting to stream...</div>
          </div>
        </div>
      )}

      {/* Visible canvas displays frames */}
      <canvas
        ref={canvasRef}
        className="rounded-xl shadow-2xl"
        style={{
          maxHeight: "100%",
          maxWidth: "100%",
          objectFit: "contain",
        }}
      />

      {/* Touch indicator - positioned relative to canvas */}
      {touchPoint && getTouchIndicatorStyle() && (
        <div style={getTouchIndicatorStyle()!} />
      )}

      {dimensions && (
        <div className="absolute bottom-2 left-2 text-xs text-white/70 bg-black/50 px-2 py-1 rounded">
          {dimensions}
        </div>
      )}
    </div>
  );
}
