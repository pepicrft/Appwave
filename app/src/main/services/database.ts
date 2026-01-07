import Database from 'better-sqlite3';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

let db: Database.Database | null = null;

function getDbPath(): string {
  const dataDir = path.join(os.homedir(), '.local', 'share', 'plasma');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, 'plasma.db');
}

export function getDatabase(): Database.Database {
  if (!db) {
    const dbPath = getDbPath();
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');

    // Create new unified projects table
    db.exec(`
      CREATE TABLE IF NOT EXISTS unified_projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        xcode_path TEXT,
        android_path TEXT,
        last_opened_at TEXT,
        created_at TEXT
      )
    `);

    // Keep old table for backward compatibility during migration
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        platforms TEXT NOT NULL DEFAULT '[]',
        last_opened_at TEXT,
        created_at TEXT
      )
    `);
  }
  return db;
}

export type Platform = 'ios' | 'android';

// New unified project record
export interface UnifiedProjectRecord {
  id: number;
  name: string;
  xcode_path: string | null;
  android_path: string | null;
  last_opened_at: string | null;
  created_at: string | null;
}

// Legacy project record (for backward compatibility)
export interface ProjectRecord {
  id: number;
  path: string;
  name: string;
  platforms: Platform[];
  last_opened_at: string | null;
  created_at: string | null;
}

// Save a unified project
export function saveUnifiedProject(
  name: string,
  xcodePath: string | null,
  androidPath: string | null
): UnifiedProjectRecord {
  const db = getDatabase();
  const now = new Date().toISOString();

  // Check if a project with these exact paths exists
  let existing: { id: number } | undefined;
  if (xcodePath && androidPath) {
    existing = db.prepare(
      'SELECT id FROM unified_projects WHERE xcode_path = ? AND android_path = ?'
    ).get(xcodePath, androidPath) as { id: number } | undefined;
  } else if (xcodePath) {
    existing = db.prepare(
      'SELECT id FROM unified_projects WHERE xcode_path = ? AND android_path IS NULL'
    ).get(xcodePath) as { id: number } | undefined;
  } else if (androidPath) {
    existing = db.prepare(
      'SELECT id FROM unified_projects WHERE android_path = ? AND xcode_path IS NULL'
    ).get(androidPath) as { id: number } | undefined;
  }

  if (existing) {
    db.prepare(
      'UPDATE unified_projects SET name = ?, last_opened_at = ? WHERE id = ?'
    ).run(name, now, existing.id);
    return getUnifiedProjectById(existing.id)!;
  } else {
    const result = db.prepare(
      'INSERT INTO unified_projects (name, xcode_path, android_path, last_opened_at, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(name, xcodePath, androidPath, now, now);
    return getUnifiedProjectById(result.lastInsertRowid as number)!;
  }
}

export function getUnifiedProjectById(id: number): UnifiedProjectRecord | null {
  const db = getDatabase();
  const record = db.prepare('SELECT * FROM unified_projects WHERE id = ?').get(id) as UnifiedProjectRecord | undefined;
  return record || null;
}

export function getRecentUnifiedProjects(limit: number = 10): UnifiedProjectRecord[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM unified_projects
    ORDER BY last_opened_at DESC
    LIMIT ?
  `).all(limit) as UnifiedProjectRecord[];
}

export function updateProjectLastOpened(id: number): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare('UPDATE unified_projects SET last_opened_at = ? WHERE id = ?').run(now, id);
}

// Legacy functions for backward compatibility
export function saveProject(projectPath: string, name: string, platforms: Platform[]): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  const platformsJson = JSON.stringify(platforms);

  const existing = db.prepare('SELECT id FROM projects WHERE path = ?').get(projectPath) as { id: number } | undefined;

  if (existing) {
    db.prepare('UPDATE projects SET name = ?, platforms = ?, last_opened_at = ? WHERE id = ?').run(name, platformsJson, now, existing.id);
  } else {
    db.prepare('INSERT INTO projects (path, name, platforms, last_opened_at, created_at) VALUES (?, ?, ?, ?, ?)').run(projectPath, name, platformsJson, now, now);
  }
}

interface DbProjectRecord {
  id: number;
  path: string;
  name: string;
  platforms: string;
  last_opened_at: string | null;
  created_at: string | null;
}

function parseProjectRecord(record: DbProjectRecord): ProjectRecord {
  return {
    ...record,
    platforms: JSON.parse(record.platforms || '[]') as Platform[],
  };
}

export function getRecentProjects(query?: string, limit: number = 10): ProjectRecord[] {
  const db = getDatabase();

  let records: DbProjectRecord[];

  if (query) {
    records = db.prepare(`
      SELECT * FROM projects
      WHERE path LIKE ?
      ORDER BY last_opened_at DESC
      LIMIT ?
    `).all(`%${query}%`, limit) as DbProjectRecord[];
  } else {
    records = db.prepare(`
      SELECT * FROM projects
      ORDER BY last_opened_at DESC
      LIMIT ?
    `).all(limit) as DbProjectRecord[];
  }

  return records.map(parseProjectRecord);
}
