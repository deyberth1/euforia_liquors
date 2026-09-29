import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, mkdirSync } from 'node:fs';
import { config } from 'dotenv';
import app from './app.js';

config();
if (!existsSync('data')) mkdirSync('data');

const port = Number(process.env.PORT || 3000);

// `app` ya vive bajo /api. Este contenedor añade el frontend compilado (si existe) para
// correr todo desde un solo proceso: npm run build && npm run dev:api
const root = new Hono();
root.route('/', app);
if (existsSync('dist')) {
  root.use('/*', serveStatic({ root: './dist' }));
  root.get('*', serveStatic({ root: './dist', path: 'index.html' }));
}

serve({ fetch: root.fetch, port }, () => {
  console.log(`API escuchando en http://localhost:${port}/api`);
});
