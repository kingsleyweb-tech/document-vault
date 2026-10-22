import { configDefaults, defineConfig } from 'vitest/config'

// The companion and the desktop app have their own Node test runners.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'companion/**', 'desktop/**'],
  },
})
