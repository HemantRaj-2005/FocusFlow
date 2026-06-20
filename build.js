import { build } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import react from '@vitejs/plugin-react';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function runBuilds() {
  // 1. Build Pages (Popup & Dashboard)
  console.log('Building Popup and Dashboard...');
  await build({
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          popup: resolve(__dirname, 'index.html'),
          dashboard: resolve(__dirname, 'dashboard.html'),
        },
        output: {
          entryFileNames: 'assets/[name].js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: 'assets/[name].[ext]',
        },
      },
      outDir: 'dist',
      emptyOutDir: true,
    },
    configFile: false,
  });

  // 2. Build Background Script
  console.log('Building Background Service Worker...');
  await build({
    build: {
      lib: {
        entry: resolve(__dirname, 'src/background/background.ts'),
        formats: ['es'],
        fileName: () => 'background.js',
      },
      outDir: 'dist',
      emptyOutDir: false,
      minify: false,
    },
    configFile: false,
  });

  // 3. Build Content Script
  console.log('Building Content Script...');
  await build({
    plugins: [react()],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    build: {
      lib: {
        entry: resolve(__dirname, 'src/content/content.tsx'),
        formats: ['iife'],
        name: 'FocusFlowContent',
        fileName: () => 'content.js',
      },
      outDir: 'dist',
      emptyOutDir: false,
      minify: false,
    },
    configFile: false,
  });

  console.log('FocusFlow build completed successfully!');
}

runBuilds().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
