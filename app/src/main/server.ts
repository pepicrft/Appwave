import * as http from 'http';
import * as fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import { detectProject } from './services/projects';
import {
  saveProject,
  getRecentProjects,
  saveUnifiedProject,
  getRecentUnifiedProjects,
  getUnifiedProjectById,
  updateProjectLastOpened,
} from './services/database';
import { validateXcodePath, validateAndroidPath } from './services/project-validation';
import { discoverProject, buildSchemeStream, getLaunchableProducts } from './services/xcode';
import {
  listSimulators,
  installAndLaunch,
  sendSessionCommand,
  sendTap,
  sendSwipe,
  getOrCreateSession,
  logEmitter,
} from './services/simulator';
import fetch from 'node-fetch';

const PORT = 3001;

interface WebSocketClient {
  ws: WebSocket;
  subscriptions: Set<string>;
}

const clients = new Map<WebSocket, WebSocketClient>();

// Active MJPEG streams per UDID
const activeStreams = new Map<string, { abort: AbortController }>();

/**
 * Start the HTTP + WebSocket server for browser mode
 */
export function startServer(): Promise<void> {
  return new Promise((resolve) => {
    const server = http.createServer(handleRequest);
    const wss = new WebSocketServer({ server });

    wss.on('connection', (ws) => {
      console.log('[server] WebSocket client connected');
      clients.set(ws, { ws, subscriptions: new Set() });

      ws.on('message', (data) => {
        handleWebSocketMessage(ws, data.toString());
      });

      ws.on('close', () => {
        console.log('[server] WebSocket client disconnected');
        const client = clients.get(ws);
        // Clean up any streams this client was subscribed to
        if (client) {
          for (const sub of client.subscriptions) {
            if (sub.startsWith('stream:')) {
              const udid = sub.replace('stream:', '');
              stopStreamForClient(udid, ws);
            }
          }
        }
        clients.delete(ws);
      });
    });

    // Forward simulator logs to WebSocket clients
    logEmitter.on('log', (logEvent) => {
      broadcast('simulator:log', logEvent);
    });

    server.listen(PORT, () => {
      console.log(`[server] HTTP server running at http://localhost:${PORT}`);
      console.log(`[server] WebSocket server ready`);
      resolve();
    });
  });
}

/**
 * Handle HTTP requests
 */
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    // Projects API
    if (path === '/api/projects/validate' && req.method === 'POST') {
      const body = await readBody(req);
      const projectPath = body.path;

      if (!fs.existsSync(projectPath)) {
        sendJson(res, { project: null, error: 'Path does not exist' });
        return;
      }

      const project = detectProject(projectPath);
      if (!project) {
        sendJson(res, { project: null, error: 'No valid project found at path' });
        return;
      }

      // Save to database
      saveProject(project.path, project.name, project.platforms);
      sendJson(res, { project });
      return;
    }

    if (path === '/api/projects/recent' && req.method === 'GET') {
      const query = url.searchParams.get('query') || undefined;
      const limit = url.searchParams.get('limit');
      const projects = getRecentProjects(query, limit ? parseInt(limit) : 10);
      // Filter out projects that no longer exist
      const result = projects.filter((p) => fs.existsSync(p.path));
      sendJson(res, result);
      return;
    }

    // New unified projects API
    if (path === '/api/projects/create' && req.method === 'POST') {
      const body = await readBody(req);
      const { name, xcodePath, androidPath } = body;

      if (!name || (!xcodePath && !androidPath)) {
        sendJson(res, { error: 'Name and at least one project path are required' }, 400);
        return;
      }

      // Validate Xcode path if provided
      let validatedXcodePath: string | null = null;
      if (xcodePath) {
        const xcodeResult = validateXcodePath(xcodePath);
        if (!xcodeResult.valid) {
          sendJson(res, { error: `Xcode: ${xcodeResult.error}` }, 400);
          return;
        }
        validatedXcodePath = xcodeResult.path;
      }

      // Validate Android path if provided
      let validatedAndroidPath: string | null = null;
      if (androidPath) {
        const androidResult = validateAndroidPath(androidPath);
        if (!androidResult.valid) {
          sendJson(res, { error: `Android: ${androidResult.error}` }, 400);
          return;
        }
        validatedAndroidPath = androidResult.path;
      }

      // Save to database
      const project = saveUnifiedProject(name, validatedXcodePath, validatedAndroidPath);
      sendJson(res, { project });
      return;
    }

    if (path === '/api/projects/unified/recent' && req.method === 'GET') {
      const limit = url.searchParams.get('limit');
      const projects = getRecentUnifiedProjects(limit ? parseInt(limit) : 10);
      sendJson(res, projects);
      return;
    }

    if (path.startsWith('/api/projects/unified/') && req.method === 'GET') {
      const id = parseInt(path.split('/').pop() || '');
      if (isNaN(id)) {
        sendJson(res, { error: 'Invalid project ID' }, 400);
        return;
      }
      const project = getUnifiedProjectById(id);
      if (!project) {
        sendJson(res, { error: 'Project not found' }, 404);
        return;
      }
      // Update last opened
      updateProjectLastOpened(id);
      sendJson(res, project);
      return;
    }

    if (path === '/api/validate/xcode' && req.method === 'POST') {
      const body = await readBody(req);
      const result = validateXcodePath(body.path || '');
      sendJson(res, result);
      return;
    }

    if (path === '/api/validate/android' && req.method === 'POST') {
      const body = await readBody(req);
      const result = validateAndroidPath(body.path || '');
      sendJson(res, result);
      return;
    }

    // Xcode API
    if (path === '/api/xcode/discover' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await discoverProject(body.path);
      sendJson(res, result);
      return;
    }

    if (path === '/api/xcode/launchable-products' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await getLaunchableProducts(body.buildDir);
      sendJson(res, result);
      return;
    }

    // Simulator API
    if (path === '/api/simulator/list' && req.method === 'GET') {
      const result = await listSimulators();
      sendJson(res, result);
      return;
    }

    if (path === '/api/simulator/launch' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await installAndLaunch(body.udid, body.appPath, body.bundleId);
      sendJson(res, { message: result });
      return;
    }

    if (path === '/api/simulator/tap' && req.method === 'POST') {
      const body = await readBody(req);
      await sendTap(body.udid, body.x, body.y, body.screenWidth, body.screenHeight);
      sendJson(res, { success: true });
      return;
    }

    if (path === '/api/simulator/swipe' && req.method === 'POST') {
      const body = await readBody(req);
      await sendSwipe(
        body.udid,
        body.startX,
        body.startY,
        body.endX,
        body.endY,
        body.screenWidth,
        body.screenHeight,
        body.duration
      );
      sendJson(res, { success: true });
      return;
    }

    if (path === '/api/simulator/touch' && req.method === 'POST') {
      const body = await readBody(req);
      await sendSessionCommand(body.udid, `touch ${body.type} ${body.touches.map((t: any) => `${t.x},${t.y}`).join(' ')}`);
      sendJson(res, { success: true });
      return;
    }

    // Health check
    if (path === '/api/health') {
      sendJson(res, { status: 'ok' });
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (error) {
    console.error('[server] Request error:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Internal error' }));
  }
}

/**
 * Handle WebSocket messages for streaming APIs
 */
async function handleWebSocketMessage(ws: WebSocket, message: string): Promise<void> {
  try {
    const data = JSON.parse(message);
    const { type, payload } = data;

    switch (type) {
      case 'xcode:build:start': {
        const { path, scheme } = payload;
        const emitter = buildSchemeStream(path, scheme);

        emitter.on('event', (buildEvent) => {
          sendToClient(ws, 'xcode:build:event', buildEvent);
        });

        emitter.on('end', () => {
          sendToClient(ws, 'xcode:build:end', {});
        });
        break;
      }

      case 'simulator:stream:start': {
        const { udid, fps = 60, quality = 0.7 } = payload;
        const client = clients.get(ws);
        if (client) {
          client.subscriptions.add(`stream:${udid}`);
        }

        // Stop existing stream if any
        const existing = activeStreams.get(udid);
        if (existing) {
          existing.abort.abort();
        }

        // Start new stream
        const session = await getOrCreateSession(udid, fps, quality);
        const abortController = new AbortController();
        activeStreams.set(udid, { abort: abortController });

        streamFramesToWebSocket(session.streamUrl, udid, ws, abortController.signal);
        break;
      }

      case 'simulator:stream:stop': {
        const { udid } = payload;
        stopStreamForClient(udid, ws);
        break;
      }
    }
  } catch (error) {
    console.error('[server] WebSocket message error:', error);
    sendToClient(ws, 'error', { message: error instanceof Error ? error.message : 'Unknown error' });
  }
}

/**
 * Stream MJPEG frames to WebSocket client
 */
async function streamFramesToWebSocket(
  streamUrl: string,
  udid: string,
  ws: WebSocket,
  signal: AbortSignal
): Promise<void> {
  try {
    const response = await fetch(streamUrl, { signal: signal as any });

    if (!response.ok) {
      throw new Error(`Failed to connect to simulator stream: ${response.statusText}`);
    }

    const body = response.body;
    if (!body) {
      throw new Error('No response body from simulator stream');
    }

    let buffer = Buffer.alloc(0);
    const boundary = '--mjpegstream';

    const nodeStream = body as unknown as NodeJS.ReadableStream & { destroy?: () => void };

    nodeStream.on('data', (chunk: Buffer) => {
      if (signal.aborted || ws.readyState !== WebSocket.OPEN) {
        nodeStream.destroy?.();
        return;
      }

      buffer = Buffer.concat([buffer, chunk]);

      let boundaryIndex: number;
      while ((boundaryIndex = buffer.indexOf(boundary)) !== -1) {
        const headerEnd = buffer.indexOf('\r\n\r\n', boundaryIndex);
        if (headerEnd === -1) break;

        const dataStart = headerEnd + 4;
        const nextBoundary = buffer.indexOf(boundary, dataStart);
        if (nextBoundary === -1) break;

        const jpegData = buffer.slice(dataStart, nextBoundary - 2);

        if (jpegData.length > 0) {
          sendToClient(ws, 'simulator:stream:frame', {
            udid,
            frame: jpegData.toString('base64'),
          });
        }

        buffer = buffer.slice(nextBoundary);
      }

      if (buffer.length > 10 * 1024 * 1024) {
        buffer = buffer.slice(-1024 * 1024);
      }
    });

    nodeStream.on('error', (err: Error) => {
      if (!signal.aborted) {
        console.error('[server] Stream error:', err);
      }
    });

    nodeStream.on('end', () => {
      activeStreams.delete(udid);
    });
  } catch (error) {
    if (!signal.aborted) {
      console.error('[server] Failed to start stream:', error);
    }
  }
}

/**
 * Stop stream for a specific client
 */
function stopStreamForClient(udid: string, ws: WebSocket): void {
  const client = clients.get(ws);
  if (client) {
    client.subscriptions.delete(`stream:${udid}`);
  }

  // Check if any other client is still subscribed
  let hasOtherSubscribers = false;
  for (const [otherWs, otherClient] of clients) {
    if (otherWs !== ws && otherClient.subscriptions.has(`stream:${udid}`)) {
      hasOtherSubscribers = true;
      break;
    }
  }

  // Only stop the stream if no other clients are subscribed
  if (!hasOtherSubscribers) {
    const stream = activeStreams.get(udid);
    if (stream) {
      stream.abort.abort();
      activeStreams.delete(udid);
    }
  }
}

/**
 * Send message to a specific WebSocket client
 */
function sendToClient(ws: WebSocket, type: string, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

/**
 * Broadcast message to all connected clients
 */
function broadcast(type: string, payload: unknown): void {
  const message = JSON.stringify({ type, payload });
  for (const client of clients.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  }
}

/**
 * Read request body as JSON
 */
function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJson(res: http.ServerResponse, data: unknown, statusCode: number = 200): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
