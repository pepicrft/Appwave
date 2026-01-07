import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { detectProject } from './projects';
import { registerProcess } from './process-manager';

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

/**
 * Discover Xcode project details including schemes, targets, and configurations
 */
export async function discoverProject(projectPath: string): Promise<XcodeProject> {
  const project = detectProject(projectPath);

  if (!project) {
    throw new Error('No Xcode project found at path');
  }

  if (project.type !== 'xcode') {
    throw new Error(`Not an Xcode project: ${project.type}`);
  }

  const isWorkspace = project.path.endsWith('.xcworkspace');
  const projectType: XcodeProjectType = isWorkspace ? 'workspace' : 'project';

  const args = isWorkspace
    ? ['-workspace', project.path, '-list', '-json']
    : ['-project', project.path, '-list', '-json'];

  return new Promise((resolve, reject) => {
    const proc = spawn('xcodebuild', args);
    registerProcess(proc);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`xcodebuild failed: ${stderr}`));
        return;
      }

      try {
        const buildList = JSON.parse(stdout);
        const info = isWorkspace ? buildList.workspace : buildList.project;

        if (!info) {
          reject(new Error('No project/workspace info in xcodebuild output'));
          return;
        }

        resolve({
          path: project.path,
          projectType,
          schemes: info.schemes || [],
          targets: info.targets || [],
          configurations: info.configurations || [],
        });
      } catch (err) {
        reject(new Error(`Failed to parse xcodebuild output: ${err}`));
      }
    });
  });
}

/**
 * Extract the build directory from xcodebuild -showBuildSettings output
 */
function extractBuildDirFromSettings(output: string): string | null {
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('CONFIGURATION_BUILD_DIR = ')) {
      return trimmed.replace('CONFIGURATION_BUILD_DIR = ', '');
    }
  }
  return null;
}

/**
 * Find build products (.app files) in a build directory
 */
async function findBuildProducts(buildDir: string): Promise<BuildProduct[]> {
  if (!fs.existsSync(buildDir)) {
    return [];
  }

  const entries = fs.readdirSync(buildDir, { withFileTypes: true });
  const products: BuildProduct[] = [];

  for (const entry of entries) {
    if (entry.name.endsWith('.app')) {
      products.push({
        name: entry.name,
        path: path.join(buildDir, entry.name),
      });
    }
  }

  return products;
}

/**
 * Get build settings to determine build directory
 */
async function getBuildSettings(
  projectPath: string,
  scheme: string
): Promise<{ buildDir: string; isWorkspace: boolean }> {
  const project = detectProject(projectPath);

  if (!project || project.type !== 'xcode') {
    throw new Error('Not an Xcode project');
  }

  const isWorkspace = project.path.endsWith('.xcworkspace');

  const args = [
    isWorkspace ? '-workspace' : '-project',
    project.path,
    '-scheme',
    scheme,
    '-configuration',
    'Debug',
    '-sdk',
    'iphonesimulator',
    '-destination',
    'generic/platform=iOS Simulator',
    'CODE_SIGN_IDENTITY=',
    'CODE_SIGNING_REQUIRED=NO',
    'CODE_SIGNING_ALLOWED=NO',
    '-showBuildSettings',
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn('xcodebuild', args);
    registerProcess(proc);
    let stdout = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('Failed to get build settings'));
        return;
      }

      const buildDir = extractBuildDirFromSettings(stdout);
      if (!buildDir) {
        reject(new Error('Could not find build directory'));
        return;
      }

      resolve({ buildDir, isWorkspace });
    });
  });
}

/**
 * Stream build output line by line for live updates
 */
export function buildSchemeStream(
  projectPath: string,
  scheme: string
): EventEmitter {
  const emitter = new EventEmitter();

  (async () => {
    try {
      const project = detectProject(projectPath);

      if (!project || project.type !== 'xcode') {
        emitter.emit('event', {
          type: 'error',
          message: 'Not an Xcode project',
        } as BuildEvent);
        emitter.emit('end');
        return;
      }

      const { buildDir, isWorkspace } = await getBuildSettings(projectPath, scheme);

      emitter.emit('event', {
        type: 'started',
        scheme,
        projectPath,
      } as BuildEvent);

      const args = [
        isWorkspace ? '-workspace' : '-project',
        project.path,
        '-scheme',
        scheme,
        '-configuration',
        'Debug',
        '-sdk',
        'iphonesimulator',
        '-destination',
        'generic/platform=iOS Simulator',
        'CODE_SIGN_IDENTITY=',
        'CODE_SIGNING_REQUIRED=NO',
        'CODE_SIGNING_ALLOWED=NO',
      ];

      const proc = spawn('xcodebuild', args);
      registerProcess(proc);

      proc.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            emitter.emit('event', { type: 'output', line } as BuildEvent);
          }
        }
      });

      proc.stderr.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) {
            emitter.emit('event', { type: 'output', line } as BuildEvent);
          }
        }
      });

      proc.on('close', async (code) => {
        const success = code === 0;
        const products = success ? await findBuildProducts(buildDir) : [];

        emitter.emit('event', {
          type: 'completed',
          success,
          buildDir,
          products,
        } as BuildEvent);

        emitter.emit('end');
      });

      proc.on('error', (err) => {
        emitter.emit('event', {
          type: 'error',
          message: err.message,
        } as BuildEvent);
        emitter.emit('end');
      });
    } catch (err) {
      emitter.emit('event', {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      } as BuildEvent);
      emitter.emit('end');
    }
  })();

  return emitter;
}

/**
 * Get launchable products from a build directory
 */
export async function getLaunchableProducts(buildDir: string): Promise<BuildProduct[]> {
  return findBuildProducts(buildDir);
}
