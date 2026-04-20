import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-mui': ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
          'vendor-charts': ['echarts'],
          'vendor-grid': ['@mui/x-data-grid'],
          'vendor-utils': ['axios', 'dayjs', 'lodash'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 18000,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:9000',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      '/uploads': {
        target: 'http://localhost:9000',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      '/ws': {
        target: 'ws://localhost:9000',
        ws: true,
      },
    },
  },
  preview: {
    port: 18000,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:9000',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      '/uploads': {
        target: 'http://localhost:9000',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
      '/ws': {
        target: 'ws://localhost:9000',
        ws: true,
      },
    },
  },
})