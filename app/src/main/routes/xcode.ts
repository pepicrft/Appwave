import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { discoverProject, buildSchemeStream, getLaunchableProducts } from '../services/xcode';

export const xcodeRoutes = new Hono();

xcodeRoutes.post('/discover', async (c) => {
  const body = await c.req.json();
  const projectPath = body.path;

  if (!projectPath) {
    return c.json({ error: 'Path is required' }, 400);
  }

  try {
    const project = await discoverProject(projectPath);
    return c.json(project);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

xcodeRoutes.post('/build/stream', async (c) => {
  const body = await c.req.json();
  const projectPath = body.path;
  const scheme = body.scheme;

  if (!projectPath || !scheme) {
    return c.json({ error: 'Path and scheme are required' }, 400);
  }

  return streamSSE(c, async (stream) => {
    const emitter = buildSchemeStream(projectPath, scheme);

    const onEvent = async (event: unknown) => {
      await stream.writeSSE({ data: JSON.stringify(event) });
    };

    emitter.on('event', onEvent);

    await new Promise<void>((resolve) => {
      emitter.on('end', () => {
        resolve();
      });

      // Handle client disconnect
      stream.onAbort(() => {
        emitter.removeAllListeners();
        resolve();
      });
    });
  });
});

xcodeRoutes.get('/launchable-products', async (c) => {
  const buildDir = c.req.query('buildDir');

  if (!buildDir) {
    return c.json({ error: 'buildDir is required' }, 400);
  }

  try {
    const products = await getLaunchableProducts(buildDir);
    return c.json({ products });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});
