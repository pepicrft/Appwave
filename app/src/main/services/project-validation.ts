import * as fs from 'fs';
import * as path from 'path';

export interface XcodeValidationResult {
  valid: boolean;
  path: string | null;
  type: 'workspace' | 'project' | null;
  error?: string;
}

export interface AndroidValidationResult {
  valid: boolean;
  path: string | null;
  error?: string;
}

/**
 * Validate an Xcode project path
 * - If directory: look up workspace or project and fail otherwise
 * - If workspace: validate it exists
 * - If project: validate it exists
 */
export function validateXcodePath(inputPath: string): XcodeValidationResult {
  if (!inputPath.trim()) {
    return { valid: false, path: null, type: null, error: 'Path is required' };
  }

  const normalizedPath = inputPath.trim();

  // Check if path exists
  if (!fs.existsSync(normalizedPath)) {
    return { valid: false, path: null, type: null, error: 'Path does not exist' };
  }

  const stats = fs.statSync(normalizedPath);
  const fileName = path.basename(normalizedPath);

  // Direct workspace path
  if (fileName.endsWith('.xcworkspace')) {
    if (!stats.isDirectory()) {
      return { valid: false, path: null, type: null, error: 'Invalid workspace bundle' };
    }
    return { valid: true, path: normalizedPath, type: 'workspace' };
  }

  // Direct project path
  if (fileName.endsWith('.xcodeproj')) {
    if (!stats.isDirectory()) {
      return { valid: false, path: null, type: null, error: 'Invalid project bundle' };
    }
    return { valid: true, path: normalizedPath, type: 'project' };
  }

  // Directory - search for workspace or project
  if (stats.isDirectory()) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(normalizedPath, { withFileTypes: true });
    } catch {
      return { valid: false, path: null, type: null, error: 'Cannot read directory' };
    }

    // Priority 1: Look for workspace
    for (const entry of entries) {
      if (entry.name.endsWith('.xcworkspace') && !entry.name.startsWith('.')) {
        const workspacePath = path.join(normalizedPath, entry.name);
        return { valid: true, path: workspacePath, type: 'workspace' };
      }
    }

    // Priority 2: Look for project
    for (const entry of entries) {
      if (entry.name.endsWith('.xcodeproj')) {
        const projectPath = path.join(normalizedPath, entry.name);
        return { valid: true, path: projectPath, type: 'project' };
      }
    }

    return { valid: false, path: null, type: null, error: 'No Xcode project or workspace found in directory' };
  }

  return { valid: false, path: null, type: null, error: 'Invalid path - must be a directory, .xcodeproj, or .xcworkspace' };
}

/**
 * Validate an Android project path
 * - If directory: validates it contains build.gradle or build.gradle.kts
 * - If gradle file path: validate it exists
 */
export function validateAndroidPath(inputPath: string): AndroidValidationResult {
  if (!inputPath.trim()) {
    return { valid: false, path: null, error: 'Path is required' };
  }

  const normalizedPath = inputPath.trim();

  // Check if path exists
  if (!fs.existsSync(normalizedPath)) {
    return { valid: false, path: null, error: 'Path does not exist' };
  }

  const stats = fs.statSync(normalizedPath);
  const fileName = path.basename(normalizedPath);

  // Direct gradle file path
  if (fileName === 'build.gradle' || fileName === 'build.gradle.kts') {
    if (!stats.isFile()) {
      return { valid: false, path: null, error: 'Invalid gradle file' };
    }
    // Return the directory containing the gradle file
    return { valid: true, path: path.dirname(normalizedPath) };
  }

  // Directory - search for gradle file
  if (stats.isDirectory()) {
    const gradlePath = path.join(normalizedPath, 'build.gradle');
    const gradleKtsPath = path.join(normalizedPath, 'build.gradle.kts');

    if (fs.existsSync(gradlePath)) {
      return { valid: true, path: normalizedPath };
    }

    if (fs.existsSync(gradleKtsPath)) {
      return { valid: true, path: normalizedPath };
    }

    return { valid: false, path: null, error: 'No build.gradle or build.gradle.kts found in directory' };
  }

  return { valid: false, path: null, error: 'Invalid path - must be a directory or gradle file' };
}
