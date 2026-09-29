import { handle } from '@hono/node-server/vercel';
import app from '../server/app.js';

// Función serverless de Vercel (runtime Node). Todas las rutas /api/* llegan aquí (ver vercel.json).
export default handle(app);
