// IPC Channel Type Definitions
// Shared between main process and renderer (via preload)

// ============================================================================
// Projects API
// ============================================================================

export type ProjectType = 'xcode' | 'android';
export type Platform = 'ios' | 'android';

export interface Project {
  path: string;
  name: string;
  type: ProjectType;
  platforms: Platform[];
  valid: boolean;
}

export interface ProjectRecord {
  id: number;
  path: string;
  name: string;
  platforms: Platform[];
  last_opened_at: string | null;
  created_at: string | null;
}

export interface ValidateProjectRequest {
  path: string;
}

export interface ValidateProjectResponse {
  project: Project | null;
  error?: string;
}

export interface GetRecentProjectsRequest {
  query?: string;
  limit?: number;
}

export type GetRecentProjectsResponse = ProjectRecord[];

// ============================================================================
// Xcode API
// ============================================================================

export type XcodeProjectType = 'project' | 'workspace';

export interface XcodeProject {
  path: string;
  projectType: XcodeProjectType;
  schemes: string[];
  targets: string[];
  configurations: string[];
}

export interface BuildProduct {
  name: string;
  path: string;
}

export interface DiscoverProjectRequest {
  path: string;
}

export type DiscoverProjectResponse = XcodeProject;

export interface BuildStreamRequest {
  path: string;
  scheme: string;
}

export interface BuildEvent {
  type: 'started' | 'output' | 'completed' | 'error';
  scheme?: string;
  projectPath?: string;
  line?: string;
  success?: boolean;
  buildDir?: string;
  products?: BuildProduct[];
  message?: string;
}

export interface GetLaunchableProductsRequest {
  buildDir: string;
}

export type GetLaunchableProductsResponse = BuildProduct[];

// ============================================================================
// Simulator API
// ============================================================================

export interface Simulator {
  udid: string;
  name: string;
  state: string;
  runtime: string;
}

export type ListSimulatorsResponse = Simulator[];

export interface LaunchAppRequest {
  udid: string;
  appPath: string;
  bundleId?: string;
}

export interface LaunchAppResponse {
  message: string;
}

export interface TouchEvent {
  udid: string;
  type: 'began' | 'moved' | 'ended';
  touches: Array<{ x: number; y: number }>;
}

export interface TapRequest {
  udid: string;
  x: number;
  y: number;
  screenWidth: number;
  screenHeight: number;
}

export interface SwipeRequest {
  udid: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  screenWidth: number;
  screenHeight: number;
  duration?: number;
}

export interface StartStreamRequest {
  udid: string;
  fps?: number;
  quality?: number;
}

export interface StreamFrame {
  udid: string;
  frame: string; // base64 encoded JPEG
}

export interface StreamLogEvent {
  type: 'info' | 'error' | 'debug' | 'frame';
  message?: string;
  frameNumber?: number;
}

// ============================================================================
// IPC Channel Names
// ============================================================================

export const IpcChannels = {
  // Projects
  PROJECTS_VALIDATE: 'projects:validate',
  PROJECTS_RECENT: 'projects:recent',

  // Xcode
  XCODE_DISCOVER: 'xcode:discover',
  XCODE_BUILD_START: 'xcode:build:start',
  XCODE_BUILD_EVENT: 'xcode:build:event', // Main -> Renderer event
  XCODE_LAUNCHABLE_PRODUCTS: 'xcode:launchable-products',

  // Simulator
  SIMULATOR_LIST: 'simulator:list',
  SIMULATOR_LAUNCH: 'simulator:launch',
  SIMULATOR_TOUCH: 'simulator:touch',
  SIMULATOR_TAP: 'simulator:tap',
  SIMULATOR_SWIPE: 'simulator:swipe',
  SIMULATOR_STREAM_START: 'simulator:stream:start',
  SIMULATOR_STREAM_STOP: 'simulator:stream:stop',
  SIMULATOR_STREAM_FRAME: 'simulator:stream:frame', // Main -> Renderer event
  SIMULATOR_LOG: 'simulator:log', // Main -> Renderer event
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];
