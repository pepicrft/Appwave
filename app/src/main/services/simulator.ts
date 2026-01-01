import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';

// Types
export interface Simulator {
  udid: string;
  name: string;
  state: string;
  runtime: string;
}

export interface StreamLogEvent {
  type: 'info' | 'error' | 'debug' | 'frame';
  message?: string;
  frameNumber?: number;
}

// Global log emitter for SSE
export const logEmitter = new EventEmitter();

// Session cache - one per UDID
interface SimulatorSession {
  udid: string;
  process: ChildProcess;
  streamUrl: string;
  stdin: NodeJS.WritableStream;
}

const sessionCache = new Map<string, SimulatorSession>();

/**
 * Find the simulator-server binary
 */
function findSimulatorServerBinary(): string | null {
  // 1. Environment variable override
  if (process.env.SIMULATOR_SERVER) {
    if (fs.existsSync(process.env.SIMULATOR_SERVER)) {
      return process.env.SIMULATOR_SERVER;
    }
  }

  // 2. Development: Check relative paths
  const possiblePaths = [
    path.join(__dirname, '../../../../bin/simulator-server'),
    path.join(__dirname, '../../../bin/simulator-server'),
    path.join(process.cwd(), 'bin/simulator-server'),
    path.join(process.cwd(), '../swift/.build/release/simulator-server'),
    path.join(process.cwd(), '../swift/.build/debug/simulator-server'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // 3. Bundled binary in resources
  if (process.resourcesPath) {
    const bundled = path.join(process.resourcesPath, 'bin', 'simulator-server');
    if (fs.existsSync(bundled)) {
      return bundled;
    }
  }

  return null;
}

/**
 * Find the AXe binary
 */
function findAxeBinary(): string | null {
  // 1. Environment variable override
  if (process.env.AXE_BINARY) {
    if (fs.existsSync(process.env.AXE_BINARY)) {
      return process.env.AXE_BINARY;
    }
  }

  // 2. Development paths
  const possiblePaths = [
    path.join(__dirname, '../../../../binaries/axe'),
    path.join(__dirname, '../../../binaries/axe'),
    path.join(process.cwd(), 'binaries/axe'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // 3. Bundled binary
  if (process.resourcesPath) {
    const bundled = path.join(process.resourcesPath, 'binaries', 'axe');
    if (fs.existsSync(bundled)) {
      return bundled;
    }
  }

  // 4. Check PATH
  const { execSync } = require('child_process');
  try {
    const result = execSync('which axe', { encoding: 'utf-8' }).trim();
    if (result && fs.existsSync(result)) {
      return result;
    }
  } catch {
    // Not in PATH
  }

  return null;
}

/**
 * Start a simulator session
 */
async function startSession(
  udid: string,
  fps: number,
  quality: number
): Promise<SimulatorSession> {
  const serverPath = findSimulatorServerBinary();
  if (!serverPath) {
    throw new Error('simulator-server binary not found');
  }

  emitLog('info', `Spawning simulator-server for ${udid}`);

  const proc = spawn(serverPath, [
    '--udid', udid,
    '--fps', fps.toString(),
    '--quality', quality.toString(),
  ], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const stdin = proc.stdin!;

  // Read stream_ready URL from stdout
  const streamUrl = await new Promise<string>((resolve, reject) => {
    let resolved = false;

    const onData = (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('stream_ready ')) {
          const url = trimmed.replace('stream_ready ', '');
          resolved = true;
          resolve(url);

          // Continue reading stdout in background
          proc.stdout?.off('data', onData);
          proc.stdout?.on('data', (d: Buffer) => {
            const msg = d.toString().trim();
            if (msg) {
              console.log(`[simulator-server stdout] ${msg}`);
              emitLog('debug', `simulator-server stdout: ${msg}`);
            }
          });
          return;
        }
        if (trimmed) {
          console.log(`[simulator-server stdout] ${trimmed}`);
          emitLog('debug', `simulator-server stdout: ${trimmed}`);
        }
      }
    };

    proc.stdout?.on('data', onData);

    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        console.log(`[simulator-server stderr] ${msg}`);
        emitLog('debug', `simulator-server stderr: ${msg}`);
      }
    });

    proc.on('error', (err) => {
      if (!resolved) {
        reject(new Error(`simulator-server error: ${err.message}`));
      }
    });

    proc.on('close', (code) => {
      if (!resolved) {
        reject(new Error(`simulator-server exited with code ${code}`));
      }
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      if (!resolved) {
        proc.kill();
        reject(new Error('Timeout waiting for stream_ready'));
      }
    }, 10000);
  });

  emitLog('info', `simulator-server ready at ${streamUrl}`);

  return {
    udid,
    process: proc,
    streamUrl,
    stdin,
  };
}

/**
 * Get or create a simulator session
 */
export async function getOrCreateSession(
  udid: string,
  fps: number = 60,
  quality: number = 0.7
): Promise<SimulatorSession> {
  const existing = sessionCache.get(udid);
  if (existing) {
    emitLog('info', `Reusing cached session for ${udid}`);
    return existing;
  }

  const session = await startSession(udid, fps, quality);
  sessionCache.set(udid, session);
  return session;
}

/**
 * Send a command to a session via stdin
 */
export async function sendSessionCommand(udid: string, command: string): Promise<void> {
  const session = sessionCache.get(udid);
  if (!session) {
    throw new Error(`No active session for simulator ${udid}`);
  }

  return new Promise((resolve, reject) => {
    session.stdin.write(`${command}\n`, (err) => {
      if (err) {
        reject(new Error(`Failed to write command: ${err.message}`));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Emit a log event
 */
function emitLog(type: StreamLogEvent['type'], message: string) {
  logEmitter.emit('log', { type, message });
}

/**
 * List all available iOS simulators
 */
export async function listSimulators(): Promise<Simulator[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn('xcrun', ['simctl', 'list', 'devices', '-j']);
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
        reject(new Error(`simctl failed: ${stderr}`));
        return;
      }

      try {
        const json = JSON.parse(stdout);
        const simulators: Simulator[] = [];

        if (json.devices) {
          for (const [runtime, devices] of Object.entries(json.devices)) {
            if (Array.isArray(devices)) {
              for (const device of devices as any[]) {
                if (device.udid && device.state !== 'Unavailable') {
                  simulators.push({
                    udid: device.udid,
                    name: device.name || '',
                    state: device.state || '',
                    runtime,
                  });
                }
              }
            }
          }
        }

        // Sort by state (Booted first) then by name
        simulators.sort((a, b) => {
          const aBooted = a.state === 'Booted';
          const bBooted = b.state === 'Booted';
          if (aBooted && !bBooted) return -1;
          if (!aBooted && bBooted) return 1;
          return a.name.localeCompare(b.name);
        });

        resolve(simulators);
      } catch (err) {
        reject(new Error(`Failed to parse simctl output: ${err}`));
      }
    });
  });
}

/**
 * Boot, install, and launch an app on a simulator
 */
export async function installAndLaunch(
  udid: string,
  appPath: string,
  bundleId?: string
): Promise<string> {
  // Boot simulator
  console.log(`Booting simulator ${udid}...`);
  await runCommand('xcrun', ['simctl', 'boot', udid]).catch((err) => {
    // Ignore if already booted
    if (!err.message.includes('current state: Booted')) {
      console.log(`Boot warning: ${err.message}`);
    }
  });

  // Install app
  console.log(`Installing app at ${appPath}...`);
  await runCommand('xcrun', ['simctl', 'install', udid, appPath]);

  // Get bundle ID if not provided
  if (!bundleId) {
    bundleId = await extractBundleId(appPath);
  }

  // Launch app
  console.log(`Launching app with bundle ID ${bundleId}...`);
  await runCommand('xcrun', ['simctl', 'launch', udid, bundleId]);

  return `App ${bundleId} launched successfully`;
}

/**
 * Run a command and return stdout
 */
function runCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
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
        reject(new Error(stderr || `Command failed with code ${code}`));
      } else {
        resolve(stdout);
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Extract bundle ID from an app's Info.plist
 */
async function extractBundleId(appPath: string): Promise<string> {
  const plistPath = path.join(appPath, 'Info.plist');
  const stdout = await runCommand('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleIdentifier',
    plistPath,
  ]);
  return stdout.trim();
}

/**
 * Send a tap using AXe
 */
export async function sendTap(
  udid: string,
  x: number,
  y: number,
  screenWidth: number,
  screenHeight: number
): Promise<void> {
  const axePath = findAxeBinary();
  if (!axePath) {
    throw new Error('AXe binary not found');
  }

  // Calculate scale factor and point coordinates
  const scaleFactor = screenWidth > 1000 ? 3.0 : screenWidth > 700 ? 2.0 : 1.0;
  const pointWidth = screenWidth / scaleFactor;
  const pointHeight = screenHeight / scaleFactor;

  const pointX = Math.round(x * pointWidth);
  const pointY = Math.round(y * pointHeight);

  console.log(`Tap: normalized(${x.toFixed(3)}, ${y.toFixed(3)}) -> points(${pointX}, ${pointY})`);

  const frameworksPath = path.join(path.dirname(axePath), 'Frameworks');

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(axePath, ['tap', '-x', pointX.toString(), '-y', pointY.toString(), '--udid', udid], {
      env: { ...process.env, DYLD_FRAMEWORK_PATH: frameworksPath },
    });

    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`AXe tap failed: ${stderr}`));
      } else {
        resolve();
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Send a swipe using AXe
 */
export async function sendSwipe(
  udid: string,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  screenWidth: number,
  screenHeight: number,
  duration: number = 0.3
): Promise<void> {
  const axePath = findAxeBinary();
  if (!axePath) {
    throw new Error('AXe binary not found');
  }

  const scaleFactor = screenWidth > 1000 ? 3.0 : screenWidth > 700 ? 2.0 : 1.0;
  const pointWidth = screenWidth / scaleFactor;
  const pointHeight = screenHeight / scaleFactor;

  const pointStartX = Math.round(startX * pointWidth);
  const pointStartY = Math.round(startY * pointHeight);
  const pointEndX = Math.round(endX * pointWidth);
  const pointEndY = Math.round(endY * pointHeight);

  const frameworksPath = path.join(path.dirname(axePath), 'Frameworks');

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(axePath, [
      'swipe',
      '--start-x', pointStartX.toString(),
      '--start-y', pointStartY.toString(),
      '--end-x', pointEndX.toString(),
      '--end-y', pointEndY.toString(),
      '--duration', duration.toString(),
      '--udid', udid,
    ], {
      env: { ...process.env, DYLD_FRAMEWORK_PATH: frameworksPath },
    });

    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`AXe swipe failed: ${stderr}`));
      } else {
        resolve();
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Proxy the MJPEG stream from simulator-server
 */
export async function proxyStream(streamUrl: string): Promise<NodeJS.ReadableStream> {
  const response = await fetch(streamUrl);
  if (!response.ok) {
    throw new Error(`Failed to connect to simulator-server: ${response.statusText}`);
  }
  return response.body as NodeJS.ReadableStream;
}
