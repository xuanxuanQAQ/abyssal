// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // ── 全局忽略 ──
  {
    ignores: [
      'dist/',
      'release/',
      'node_modules/',
      'coverage/',
      'build/',
      '*.mjs',          // esbuild.main.mjs 等构建脚本
      '**/*.cjs',       // CommonJS 脚本（tesseract-worker 等）
      'vite.*.config.*',
      'vitest.config.*',
    ],
  },

  // ── 基础规则 ──
  eslint.configs.recommended,

  // ── TypeScript 推荐规则 ──
  ...tseslint.configs.recommended,

  // ── 全局 linterOptions ──
  {
    linterOptions: {
      // 允许行内 eslint-disable 引用未安装的插件规则
      // （如 deprecation/deprecation, react-hooks/exhaustive-deps）
      reportUnusedDisableDirectives: 'warn',
    },
  },

  // ── 项目定制 ──
  {
    rules: {
      // 允许 any（项目大量使用 Record<string, unknown> 和 as any 过渡）
      '@typescript-eslint/no-explicit-any': 'off',

      // 允许 require()（mcp-adapter 和 migration 中使用动态 require）
      '@typescript-eslint/no-require-imports': 'off',

      // 允许未使用的变量（以 _ 开头的）
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],

      // 允许空函数（stub handler）
      '@typescript-eslint/no-empty-function': 'off',

      // 允许 non-null assertion（better-sqlite3 API 经常需要）
      '@typescript-eslint/no-non-null-assertion': 'off',

      // 不强制返回类型标注
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      // csl-engine.ts 中需要 this 别名传入 citeproc 回调
      '@typescript-eslint/no-this-alias': 'off',

      // 现有代码中有 optional chain + non-null assertion 混用
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'warn',

      // 降级为 warn（现有代码有 let 应为 const 的情况）
      'prefer-const': 'warn',

      // 允许行内 eslint-disable 引用未安装的插件规则（如 deprecation/, react-hooks/）
      // eslint v9 默认对未知规则报错——在渐进迁移中需要关闭
      'no-useless-escape': 'warn',

      // switch default-init 模式不算无用赋值
      'no-useless-assignment': 'warn',

      // 禁止 console.log（warn/error 允许）
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // ── 测试文件放宽 ──
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'src/__test-utils__/**'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },

  // ── Renderer 文件：未安装 react-hooks 插件，跳过 reportUnused ──
  {
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },

  // ── MCP adapter：引用了 deprecation 插件 ──
  {
    files: ['src/mcp-adapter/**/*.ts'],
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
);
