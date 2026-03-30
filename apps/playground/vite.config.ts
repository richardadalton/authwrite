import { fileURLToPath, URL } from 'url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // /authwrite/ matches the GitHub Pages URL for the richardadalton/authwrite repo.
  // Change this if your repo has a different name.
  base: '/authwrite/',
  resolve: {
    alias: {
      '@authwrite/core': fileURLToPath(
        new URL('../../packages/core/src/index.ts', import.meta.url)
      ),
    },
  },
})
