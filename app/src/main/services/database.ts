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

    // Create tables if they don't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        last_opened_at TEXT,
        created_at TEXT
      )
    `);
  }
  return db;
}

export interface ProjectRecord {
  id: number;
  path: string;
  name: string;
  last_opened_at: string | null;
  created_at: string | null;
}

export function saveProject(projectPath: string, name: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();

  const existing = db.prepare('SELECT id FROM projects WHERE path = ?').get(projectPath) as { id: number } | undefined;

  if (existing) {
    db.prepare('UPDATE projects SET name = ?, last_opened_at = ? WHERE id = ?').run(name, now, existing.id);
  } else {
    db.prepare('INSERT INTO projects (path, name, last_opened_at, created_at) VALUES (?, ?, ?, ?)').run(projectPath, name, now, now);
  }
}

export function getRecentProjects(query?: string, limit: number = 10): ProjectRecord[] {
  const db = getDatabase();

  if (query) {
    return db.prepare(`
      SELECT * FROM projects
      WHERE path LIKE ?
      ORDER BY last_opened_at DESC
      LIMIT ?
    `).all(`%${query}%`, limit) as ProjectRecord[];
  }

  return db.prepare(`
    SELECT * FROM projects
    ORDER BY last_opened_at DESC
    LIMIT ?
  `).all(limit) as ProjectRecord[];
}
