import { defineConfig } from 'vite'

export default defineConfig({
  // Set the base path to your subfolder path on GitHub Pages
  base: '/doodl/',
  
  build: {
    outDir: 'dist',
  },
  
  server: {
    port: 3000,
    open: true,
  },
})