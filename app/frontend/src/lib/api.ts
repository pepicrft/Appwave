/**
 * API client - uses HTTP/WebSocket to communicate with the backend server
 */

const API_BASE = 'http://localhost:3001';
const WS_BASE = 'ws://localhost:3001';

// WebSocket connection
let ws: WebSocket | null = null;
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
const wsListeners = new Map<string, Set<(payload: unknown) => void>>();

function connectWebSocket(): WebSocket {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return ws;
  }

  ws = new WebSocket(WS_BASE);

  ws.onopen = () => {
    console.log('[api] WebSocket connected');
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
  };

  ws.onmessage = (event) => {
    try {
      const { type, payload } = JSON.parse(event.data);
      const listeners = wsListeners.get(type);
      if (listeners) {
        for (const listener of listeners) {
          listener(payload);
        }
      }
    } catch (e) {
      console.error('[api] Failed to parse WebSocket message:', e);
    }
  };

  ws.onclose = () => {
    console.log('[api] WebSocket disconnected');
    ws = null;
    // Reconnect after 2 seconds
    if (!wsReconnectTimer) {
      wsReconnectTimer = setTimeout(() => {
        wsReconnectTimer = null;
        connectWebSocket();
      }, 2000);
    }
  };

  ws.onerror = (error) => {
    console.error('[api] WebSocket error:', error);
  };

  return ws;
}

function addWsListener(type: string, callback: (payload: unknown) => void): () => void {
  if (!wsListeners.has(type)) {
    wsListeners.set(type, new Set());
  }
  wsListeners.get(type)!.add(callback);

  return () => {
    const listeners = wsListeners.get(type);
    if (listeners) {
      listeners.delete(callback);
    }
  };
}

function sendWsMessage(type: string, payload: unknown): void {
  const socket = connectWebSocket();
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, payload }));
  } else {
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type, payload }));
    }, { once: true });
  }
}

async function httpPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Request failed');
  }
  return response.json();
}

async function httpGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || 'Request failed');
  }
  return response.json();
}

// Types
export type Platform = 'ios' | 'android';

interface ValidateProjectRequest {
  path: string;
}

interface Project {
  path: string;
  name: string;
  type: 'xcode' | 'android';
  platforms: Platform[];
  valid: boolean;
}

interface ValidateProjectResponse {
  project: Project | null;
  error?: string;
}

interface GetRecentProjectsRequest {
  query?: string;
  limit?: number;
}

export interface ProjectRecord {
  id: number;
  path: string;
  name: string;
  platforms: Platform[];
  last_opened_at: string | null;
  created_at: string | null;
}

type GetRecentProjectsResponse = ProjectRecord[];

// New unified project types
export interface UnifiedProject {
  id: number;
  name: string;
  xcode_path: string | null;
  android_path: string | null;
  last_opened_at: string | null;
  created_at: string | null;
}

interface CreateProjectRequest {
  name: string;
  xcodePath?: string;
  androidPath?: string;
  directory?: string;
}

interface CreateProjectResponse {
  project?: UnifiedProject;
  error?: string;
}

interface XcodeValidationResult {
  valid: boolean;
  path: string | null;
  type: 'workspace' | 'project' | null;
  error?: string;
}

interface AndroidValidationResult {
  valid: boolean;
  path: string | null;
  error?: string;
}

interface DiscoverProjectRequest {
  path: string;
}

interface XcodeProject {
  path: string;
  projectType: 'project' | 'workspace';
  schemes: string[];
  targets: string[];
  configurations: string[];
}

type DiscoverProjectResponse = XcodeProject;

interface BuildStreamRequest {
  path: string;
  scheme: string;
}

interface BuildProduct {
  name: string;
  path: string;
}

interface BuildEvent {
  type: 'started' | 'output' | 'completed' | 'error';
  scheme?: string;
  projectPath?: string;
  line?: string;
  success?: boolean;
  buildDir?: string;
  products?: BuildProduct[];
  message?: string;
}

interface GetLaunchableProductsRequest {
  buildDir: string;
}

type GetLaunchableProductsResponse = BuildProduct[];

interface Simulator {
  udid: string;
  name: string;
  state: string;
  runtime: string;
}

type ListSimulatorsResponse = Simulator[];

interface LaunchAppRequest {
  udid: string;
  appPath: string;
  bundleId?: string;
}

interface LaunchAppResponse {
  message: string;
}

interface TapRequest {
  udid: string;
  x: number;
  y: number;
  screenWidth: number;
  screenHeight: number;
}

interface SwipeRequest {
  udid: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  screenWidth: number;
  screenHeight: number;
  duration?: number;
}

interface StartStreamRequest {
  udid: string;
  fps?: number;
  quality?: number;
}

interface StreamFrame {
  udid: string;
  frame: string;
}

interface StreamLogEvent {
  type: 'info' | 'error' | 'debug' | 'frame';
  message?: string;
  frameNumber?: number;
}

/**
 * Unified API client
 */
export const api = {
  // App info (uses Electron IPC if available, otherwise returns defaults)
  getVersion: async (): Promise<string> => {
    if (window.electron) {
      return window.electron.getVersion();
    }
    return '0.1.0-dev';
  },

  // Dialog (uses Electron IPC if available, otherwise prompts)
  showOpenDialog: async (options: { properties?: string[] }): Promise<{ canceled: boolean; filePaths: string[] }> => {
    if (window.electron) {
      return window.electron.showOpenDialog(options as Electron.OpenDialogOptions);
    }
    const path = window.prompt('Enter project path:');
    if (path) {
      return { canceled: false, filePaths: [path] };
    }
    return { canceled: true, filePaths: [] };
  },

  // App control
  quit: (): void => {
    window.electron?.quit();
  },
  minimize: (): void => {
    window.electron?.minimize();
  },
  maximize: (): void => {
    window.electron?.maximize();
  },

  // Platform info
  platform: window.electron?.platform || 'darwin',

  // Projects API
  projects: {
    validate: async (request: ValidateProjectRequest): Promise<ValidateProjectResponse> => {
      return httpPost('/api/projects/validate', request);
    },

    getRecent: async (request?: GetRecentProjectsRequest): Promise<GetRecentProjectsResponse> => {
      const params = new URLSearchParams();
      if (request?.query) params.set('query', request.query);
      if (request?.limit) params.set('limit', String(request.limit));
      const queryString = params.toString();
      return httpGet(`/api/projects/recent${queryString ? `?${queryString}` : ''}`);
    },

    // Unified project methods
    create: async (request: CreateProjectRequest): Promise<CreateProjectResponse> => {
      return httpPost('/api/projects/create', request);
    },

    getRecentUnified: async (limit?: number): Promise<UnifiedProject[]> => {
      const params = limit ? `?limit=${limit}` : '';
      return httpGet(`/api/projects/unified/recent${params}`);
    },

    getUnifiedById: async (id: number): Promise<UnifiedProject> => {
      return httpGet(`/api/projects/unified/${id}`);
    },

    validateXcode: async (path: string): Promise<XcodeValidationResult> => {
      return httpPost('/api/validate/xcode', { path });
    },

    validateAndroid: async (path: string): Promise<AndroidValidationResult> => {
      return httpPost('/api/validate/android', { path });
    },
  },

  // Xcode API
  xcode: {
    discover: async (request: DiscoverProjectRequest): Promise<DiscoverProjectResponse> => {
      return httpPost('/api/xcode/discover', request);
    },

    startBuild: async (request: BuildStreamRequest): Promise<void> => {
      sendWsMessage('xcode:build:start', request);
    },

    onBuildEvent: (callback: (event: BuildEvent) => void): (() => void) => {
      connectWebSocket();
      return addWsListener('xcode:build:event', callback as (payload: unknown) => void);
    },

    getLaunchableProducts: async (request: GetLaunchableProductsRequest): Promise<GetLaunchableProductsResponse> => {
      return httpPost('/api/xcode/launchable-products', request);
    },
  },

  // Simulator API
  simulator: {
    list: async (): Promise<ListSimulatorsResponse> => {
      return httpGet('/api/simulator/list');
    },

    launch: async (request: LaunchAppRequest): Promise<LaunchAppResponse> => {
      return httpPost('/api/simulator/launch', request);
    },

    tap: async (request: TapRequest): Promise<void> => {
      await httpPost('/api/simulator/tap', request);
    },

    swipe: async (request: SwipeRequest): Promise<void> => {
      await httpPost('/api/simulator/swipe', request);
    },

    startStream: async (request: StartStreamRequest): Promise<void> => {
      sendWsMessage('simulator:stream:start', request);
    },

    stopStream: async (udid: string): Promise<void> => {
      sendWsMessage('simulator:stream:stop', { udid });
    },

    onStreamFrame: (callback: (frame: StreamFrame) => void): (() => void) => {
      connectWebSocket();
      return addWsListener('simulator:stream:frame', callback as (payload: unknown) => void);
    },

    onLog: (callback: (log: StreamLogEvent) => void): (() => void) => {
      connectWebSocket();
      return addWsListener('simulator:log', callback as (payload: unknown) => void);
    },
  },
};

// Initialize WebSocket connection
if (typeof window !== 'undefined') {
  connectWebSocket();
}

// Re-export types for consumers
export type {
  BuildEvent,
  BuildProduct,
  Simulator,
  StreamFrame,
  StreamLogEvent,
  XcodeProject,
};
