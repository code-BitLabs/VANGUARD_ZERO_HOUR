import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      sourcemap: false,
      target: 'es2022',
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (
              id.includes('node_modules/three/') ||
              id.includes('node_modules/three\\') ||
              id.includes('node_modules/three-mesh-bvh') ||
              id.includes('node_modules/postprocessing')
            ) {
              return 'vendor-three';
            }
            if (
              id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/@radix-ui') ||
              id.includes('node_modules/lucide-react')
            ) {
              return 'vendor-react-ui';
            }
            if (
              id.includes('node_modules/zustand') ||
              id.includes('node_modules/zod') ||
              id.includes('node_modules/xstate') ||
              id.includes('node_modules/idb-keyval')
            ) {
              return 'vendor-state';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
