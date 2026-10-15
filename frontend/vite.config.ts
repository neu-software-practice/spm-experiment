import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Split third-party code into stable vendor chunks so app changes don't invalidate them
const vendorChunks: [name: string, test: RegExp][] = [
  ['react', /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/],
  ['dnd-kit', /[\\/]node_modules[\\/]@dnd-kit[\\/]/],
  ['vendor', /[\\/]node_modules[\\/]/],
]

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: vendorChunks.map(([name, test], index) => ({
            name,
            test,
            priority: vendorChunks.length - index,
          })),
        },
      },
    },
  },
})
