import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import * as path from 'path';
import * as fs from 'fs';
import { healthRoutes } from './routes/health';
import { projectsRoutes } from './routes/projects';
import { xcodeRoutes } from './routes/xcode';
import { simulatorRoutes } from './routes/simulator';

const app = new Hono();

// CORS for development
app.use('*', cors());

// API routes
app.route('/api', healthRoutes);
app.route('/api/projects', projectsRoutes);
app.route('/api/xcode', xcodeRoutes);
app.route('/api/simulator', simulatorRoutes);

// Serve static frontend in production
const isDev = process.env.NODE_ENV === 'development';
if (!isDev) {
  const frontendPath = path.join(__dirname, '../../frontend/dist');
  if (fs.existsSync(frontendPath)) {
    app.use('/*', serveStatic({ root: frontendPath }));
    // SPA fallback
    app.get('*', (c) => {
      const indexPath = path.join(frontendPath, 'index.html');
      const html = fs.readFileSync(indexPath, 'utf-8');
      return c.html(html);
    });
  }
}

export async function startServer(port: number = 4000): Promise<number> {
  return new Promise((resolve, reject) => {
    try {
      const server = serve({
        fetch: app.fetch,
        port,
      }, (info) => {
        console.log(`Server running on http://localhost:${info.port}`);
        resolve(info.port);
      });

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`Port ${port} in use, trying ${port + 1}`);
          startServer(port + 1).then(resolve).catch(reject);
        } else {
          reject(err);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
