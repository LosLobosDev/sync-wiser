import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'sync-wiser': path.resolve(__dirname, '../../src'),
      '@sync-wiser/react': path.resolve(__dirname, '../../src/react'),
    },
  },
  server: {
    port: 5173,
  },
});
