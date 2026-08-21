import { defineConfig } from 'vite'

export default defineConfig({
  // Ensures relative paths work correctly when deployed to GitHub Pages
  base: '/',
  
  build: {
    // Outputs the build files to the dist folder expected by GitHub Pages
    outDir: 'dist',
  },
  
  server: {
    port: 3000,
    open: true,
  },
})