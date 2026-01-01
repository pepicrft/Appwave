import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { stream as honoStream } from 'hono/streaming';
import {
  listSimulators,
  installAndLaunch,
  getOrCreateSession,
  sendSessionCommand,
  sendTap,
  sendSwipe,
  proxyStream,
  logEmitter,
} from '../services/simulator';

export const simulatorRoutes = new Hono();

/**
 * List all available simulators
 */
simulatorRoutes.get('/list', async (c) => {
  try {
    const simulators = await listSimulators();
    return c.json({ simulators });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

/**
 * Install and launch an app on a simulator
 */
simulatorRoutes.post('/launch', async (c) => {
  const body = await c.req.json();
  const { udid, appPath, bundleId } = body;

  if (!udid || !appPath) {
    return c.json({ error: 'udid and appPath are required' }, 400);
  }

  try {
    const result = await installAndLaunch(udid, appPath, bundleId);
    return c.json({ message: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

/**
 * Get MJPEG stream from simulator
 */
simulatorRoutes.get('/stream', async (c) => {
  const udid = c.req.query('udid');
  const fpsStr = c.req.query('fps');
  const qualityStr = c.req.query('quality');

  if (!udid) {
    return c.json({ error: 'udid is required' }, 400);
  }

  const fps = fpsStr ? parseInt(fpsStr, 10) : 60;
  const quality = qualityStr ? parseFloat(qualityStr) : 0.7;

  try {
    const session = await getOrCreateSession(udid, fps, quality);

    // Proxy the MJPEG stream from simulator-server
    const sourceStream = await proxyStream(session.streamUrl);

    return honoStream(c, async (stream) => {
      // Set MJPEG headers
      c.header('Content-Type', 'multipart/x-mixed-replace; boundary=frame');
      c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      c.header('Pragma', 'no-cache');
      c.header('Expires', '0');
      c.header('Connection', 'keep-alive');

      // Pipe the source stream to the response
      for await (const chunk of sourceStream) {
        await stream.write(chunk);
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Stream error:', message);
    return c.json({ error: message }, 500);
  }
});

/**
 * SSE endpoint for stream logs
 */
simulatorRoutes.get('/stream/logs', async (c) => {
  return streamSSE(c, async (stream) => {
    const onLog = async (event: { type: string; message?: string }) => {
      await stream.writeSSE({ data: JSON.stringify(event) });
    };

    logEmitter.on('log', onLog);

    // Keep the connection open until client disconnects
    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        logEmitter.off('log', onLog);
        resolve();
      });
    });
  });
});

/**
 * Send touch command to simulator via stdin
 */
simulatorRoutes.post('/touch', async (c) => {
  const body = await c.req.json();
  const { udid, action, x, y } = body;

  if (!udid || !action || x === undefined || y === undefined) {
    return c.json({ error: 'udid, action, x, and y are required' }, 400);
  }

  try {
    const command = `touch ${action} ${x},${y}`;
    await sendSessionCommand(udid, command);
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

/**
 * Send tap via AXe binary
 */
simulatorRoutes.post('/tap', async (c) => {
  const body = await c.req.json();
  const { udid, x, y, screenWidth, screenHeight } = body;

  if (!udid || x === undefined || y === undefined || !screenWidth || !screenHeight) {
    return c.json({
      error: 'udid, x, y, screenWidth, and screenHeight are required',
    }, 400);
  }

  try {
    await sendTap(udid, x, y, screenWidth, screenHeight);
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

/**
 * Send swipe via AXe binary
 */
simulatorRoutes.post('/swipe', async (c) => {
  const body = await c.req.json();
  const { udid, startX, startY, endX, endY, screenWidth, screenHeight, duration } = body;

  if (
    !udid ||
    startX === undefined ||
    startY === undefined ||
    endX === undefined ||
    endY === undefined ||
    !screenWidth ||
    !screenHeight
  ) {
    return c.json({
      error: 'udid, startX, startY, endX, endY, screenWidth, and screenHeight are required',
    }, 400);
  }

  try {
    await sendSwipe(udid, startX, startY, endX, endY, screenWidth, screenHeight, duration);
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});
