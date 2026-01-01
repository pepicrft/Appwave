import { Hono } from 'hono';
import * as fs from 'fs';
import { detectProject } from '../services/projects';
import { saveProject, getRecentProjects } from '../services/database';

export const projectsRoutes = new Hono();

projectsRoutes.post('/validate', async (c) => {
  const body = await c.req.json();
  const projectPath = body.path;

  if (!projectPath) {
    return c.json({ error: 'Path is required' }, 400);
  }

  if (!fs.existsSync(projectPath)) {
    return c.json({ error: 'Path does not exist' }, 400);
  }

  const project = detectProject(projectPath);

  if (!project) {
    return c.json({ error: 'No Xcode or Android project found' }, 400);
  }

  // Save to database
  try {
    saveProject(project.path, project.name);
  } catch (err) {
    console.warn('Failed to save project to database:', err);
  }

  return c.json(project);
});

projectsRoutes.get('/recent', (c) => {
  const query = c.req.query('query');
  const limitStr = c.req.query('limit');
  const limit = limitStr ? parseInt(limitStr, 10) : 10;

  try {
    const records = getRecentProjects(query, limit);

    // Validate each project still exists and add type
    const projects = records
      .map((record) => {
        const detected = detectProject(record.path);
        if (!detected) return null;
        return {
          path: record.path,
          name: record.name,
          type: detected.type,
          valid: detected.valid,
        };
      })
      .filter((p) => p !== null);

    return c.json({ projects });
  } catch (err) {
    console.error('Failed to fetch projects:', err);
    return c.json({ error: 'Failed to fetch projects' }, 500);
  }
});
