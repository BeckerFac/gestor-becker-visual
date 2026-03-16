import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/modules/**/*.service.ts', 'src/modules/**/*.controller.ts'],
      thresholds: { statements: 60 },
    },
    testTimeout: 15000,
    hookTimeout: 15000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
