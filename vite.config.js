import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { unlink } from 'node:fs/promises';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'TRANSCRIPTION_');
  const proxy = { '/api': { target: `http://127.0.0.1:${env.TRANSCRIPTION_PORT || 3001}`, changeOrigin: true } };
  return {
    plugins: [react(), {
      name: 'exclude-unused-legacy-models',
      apply: 'build',
      async closeBundle() {
        // Keep source assets intact; omit unused legacy copies from distribution.
        for (const name of ['avatar-2.vrm', 'avatar-3.vrm', 'avatar-4.vrm', 'default.vrm']) {
          await unlink(path.resolve('dist/models', name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
        }
      },
    }],
    build: {
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('@pixiv/three-vrm')) return 'vrm';
            if (id.includes('three') || id.includes('@react-three')) return 'three';
            if (id.includes('react') || id.includes('react-dom')) return 'react-vendor';
          },
        },
      },
    },
    server: { port: 5173, strictPort: true, proxy },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy },
  };
});
