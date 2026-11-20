import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize } from 'node:path';

// In dev the page lives at /vertex/ like in production; amog.fun's shared /assets (amog.css, ach.js) are
// served straight from ../public so the page looks the same before it is built.
const shared = fileURLToPath(new URL('../public/assets', import.meta.url));
const TYPES: Record<string, string> = { '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

const siteAssets = (): Plugin => ({
  name: 'amog-shared-assets',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const url = (req.url ?? '').split('?')[0];
      if (!url.startsWith('/assets/')) return next();
      const file = normalize(join(shared, url.slice('/assets/'.length)));
      if (!file.startsWith(shared) || !existsSync(file) || !statSync(file).isFile()) return next();
      res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
      createReadStream(file).pipe(res);
    });
  },
});

// `npm run build` checks the bundle into dist/; `npm run build:site` writes it to ../public/vertex, which is what
// `wrangler deploy` publishes at amog.fun/vertex.
const site = process.env.VERTEX_SITE === '1';

export default defineConfig({
  base: '/vertex/',
  plugins: [siteAssets()],
  server: { port: 5183, strictPort: true },
  build: {
    outDir: site ? '../public/vertex' : 'dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
