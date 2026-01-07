import * as fs from 'fs';
import * as path from 'path';
import type { Platform, ProjectType } from '../../shared/ipc-types';

export interface Project {
  path: string;
  name: string;
  type: ProjectType;
  platforms: Platform[];
  valid: boolean;
}

/**
 * Check if a path points directly to a project file/bundle
 */
function isProjectPath(filePath: string): boolean {
  const name = path.basename(filePath);
  return (
    name.endsWith('.xcworkspace') ||
    name.endsWith('.xcodeproj') ||
    name === 'build.gradle' ||
    name === 'build.gradle.kts'
  );
}

/**
 * Detect project from a direct project file/bundle path
 */
function detectFromProjectPath(projectPath: string): Project | null {
  const fileName = path.basename(projectPath);

  // Xcode workspace
  if (fileName.endsWith('.xcworkspace')) {
    const name = fileName.replace('.xcworkspace', '');
    return {
      type: 'xcode',
      name,
      path: projectPath,
      platforms: ['ios'],
      valid: fs.existsSync(projectPath),
    };
  }

  // Xcode project
  if (fileName.endsWith('.xcodeproj')) {
    const name = fileName.replace('.xcodeproj', '');
    return {
      type: 'xcode',
      name,
      path: projectPath,
      platforms: ['ios'],
      valid: fs.existsSync(projectPath),
    };
  }

  // Android Gradle build file
  if (fileName === 'build.gradle' || fileName === 'build.gradle.kts') {
    const parentDir = path.dirname(projectPath);
    const name = path.basename(parentDir) || 'Unknown';
    return {
      type: 'android',
      name,
      path: projectPath,
      platforms: ['android'],
      valid: fs.existsSync(projectPath),
    };
  }

  return null;
}

/**
 * Detect project by searching a directory
 */
function detectFromDirectory(dirPath: string): Project | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return null;
  }

  // First pass: look for workspace (takes priority)
  for (const entry of entries) {
    if (entry.name.endsWith('.xcworkspace')) {
      const name = entry.name.replace('.xcworkspace', '');
      const projectPath = path.join(dirPath, entry.name);
      return {
        type: 'xcode',
        name,
        path: projectPath,
        platforms: ['ios'],
        valid: fs.existsSync(projectPath),
      };
    }
  }

  // Second pass: look for project or gradle
  for (const entry of entries) {
    if (entry.name.endsWith('.xcodeproj')) {
      const name = entry.name.replace('.xcodeproj', '');
      const projectPath = path.join(dirPath, entry.name);
      return {
        type: 'xcode',
        name,
        path: projectPath,
        platforms: ['ios'],
        valid: fs.existsSync(projectPath),
      };
    }

    if (entry.name === 'build.gradle' || entry.name === 'build.gradle.kts') {
      const name = path.basename(dirPath) || 'Unknown';
      const projectPath = path.join(dirPath, entry.name);
      return {
        type: 'android',
        name,
        path: projectPath,
        platforms: ['android'],
        valid: fs.existsSync(projectPath),
      };
    }
  }

  return null;
}

/**
 * Detect project from a path
 */
export function detectProject(projectPath: string): Project | null {
  if (!fs.existsSync(projectPath)) {
    return null;
  }

  // If the path itself is a project file/bundle, use it directly
  if (isProjectPath(projectPath)) {
    return detectFromProjectPath(projectPath);
  }

  // Check if it's a directory
  const stats = fs.statSync(projectPath);
  if (stats.isDirectory()) {
    return detectFromDirectory(projectPath);
  }

  return null;
}
