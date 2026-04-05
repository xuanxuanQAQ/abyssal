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
          include: ['src/core/**/*.test.ts', 'src/shared-types/**/*.test.ts', 'src/adapter/**/*.test.ts', 'src/electron/**/*.test.ts', 'src/cli/**/*.test.ts', 'src/copilot-runtime/**/*.test.ts'],
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
      {
        extends: true,
        test: {
          name: 'smoke',
          include: ['tests/e2e/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['src/__test-utils__/setup-integration.ts'],
          testTimeout: 30_000,
          pool: 'forks',
        },
      },
      // ── 黄金样本测试：冻结关键输出结构，防止重构漂移 ──
      {
        extends: true,
        test: {
          name: 'golden',
          include: ['tests/golden/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['src/__test-utils__/setup-unit.ts'],
        },
      },
      // ── 鲁棒性测试：故障注入、异常输入、边界条件 ──
      {
        extends: true,
        test: {
          name: 'robustness',
          include: ['tests/robustness/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['src/__test-utils__/setup-unit.ts'],
        },
      },
      // ── 模型评估测试：低频执行，真实 provider 质量监控 ──
      {
        extends: true,
        test: {
          name: 'evaluation',
          include: ['tests/evaluation/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['src/__test-utils__/setup-unit.ts'],
          testTimeout: 60_000,
        },
      },
    ],
  },
});
