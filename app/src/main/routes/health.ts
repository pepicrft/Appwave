import { Hono } from 'hono';

export const healthRoutes = new Hono();

healthRoutes.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

healthRoutes.get('/about', (c) => {
  return c.json({
    name: 'Plasma',
    version: '0.1.0',
    description: 'AI-powered app development',
  });
});
