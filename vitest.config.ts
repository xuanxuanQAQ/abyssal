import { defineConfig } from 'vitest/config';
import path from 'path';

const alias = {
  '@core': path.resolve(__dirname, 'src/core'),
  '@electron': path.resolve(__dirname, 'src/electron'),
  '@renderer': path.resolve(__dirname, 'src/renderer'),
  '@shared-types': path.resolve(__dirname, 'src/shared-types'),
  '@test-utils': path.resolve(__dirname, 'src/__test-utils__'),
};

export default defineConfig({
  resolve: { alias },
  test: {
    globals: true,
    projects: [
      // ── 单元测试：就近放置，纯逻辑，不依赖 Electron / DOM ──
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/core/**/*.test.ts', 'src/shared-types/**/*.test.ts', 'src/adapter/**/*.test.ts', 'src/electron/**/*.test.ts', 'src/cli/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['src/__test-utils__/setup-unit.ts'],
        },
      },
      // ── 集成测试：独立目录，跨模块 + 真实 SQLite ──
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['src/__test-utils__/setup-integration.ts'],
          testTimeout: 30_000,
          pool: 'forks',
        },
      },
      // ── 渲染进程测试：就近放置，React 组件 + Zustand store ──
      {
        extends: true,
        test: {
          name: 'renderer',
          include: ['src/renderer/**/*.test.ts', 'src/renderer/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['src/__test-utils__/setup-renderer.ts'],
        },
      },
    ],
  },
});
