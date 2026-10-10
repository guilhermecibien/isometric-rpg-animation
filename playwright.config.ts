import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5173', viewport: { width: 1400, height: 800 }, launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] } },
  webServer: { command: 'npx vite examples/phaser-demo --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI, timeout: 60_000 },
});
