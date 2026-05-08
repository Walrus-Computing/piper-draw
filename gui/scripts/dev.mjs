#!/usr/bin/env node
// Dev runner: find free ports for Vite + FastAPI, then launch concurrently.
// Honors VITE_PORT / BACKEND_PORT as preferred starting points; if either is
// in use we walk upward until we find a free one so multiple devs can run
// `make dev` / `npm run dev` side by side without clashing.

import net from 'node:net';
import { spawn } from 'node:child_process';

function findFreePort(start) {
  return new Promise((resolve, reject) => {
    const attempt = (port) => {
      const server = net.createServer();
      server.unref();
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && port - start < 100) {
          attempt(port + 1);
        } else {
          reject(err);
        }
      });
      server.listen(port, '127.0.0.1', () => {
        const { port: bound } = server.address();
        server.close(() => resolve(bound));
      });
    };
    attempt(start);
  });
}

const vitePref = Number(process.env.VITE_PORT ?? 5173);
const backendPref = Number(process.env.BACKEND_PORT ?? 8000);

const [vitePort, backendPort] = await Promise.all([
  findFreePort(vitePref),
  findFreePort(backendPref),
]);

if (vitePort !== vitePref) {
  console.log(`[dev] frontend port ${vitePref} in use, using ${vitePort}`);
}
if (backendPort !== backendPref) {
  console.log(`[dev] backend port ${backendPref} in use, using ${backendPort}`);
}
console.log(`[dev] frontend http://localhost:${vitePort}  backend http://localhost:${backendPort}`);

const env = {
  ...process.env,
  VITE_PORT: String(vitePort),
  BACKEND_PORT: String(backendPort),
};

const child = spawn(
  'npx',
  ['concurrently', '--kill-others-on-fail', 'npm:dev:frontend', 'npm:dev:backend'],
  { stdio: 'inherit', env },
);

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
