/**
 * Standalone server entry point for browser mode
 * Run with: pnpm dev:browser
 */

import { startServer } from './server';

console.log('[standalone] Starting Plasma server for browser mode...');

startServer()
  .then(() => {
    console.log('[standalone] Server started successfully');
    console.log('[standalone] Open http://localhost:5173 in your browser');
  })
  .catch((err) => {
    console.error('[standalone] Failed to start server:', err);
    process.exit(1);
  });

// Handle shutdown gracefully
process.on('SIGINT', () => {
  console.log('\n[standalone] Shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[standalone] Shutting down...');
  process.exit(0);
});
