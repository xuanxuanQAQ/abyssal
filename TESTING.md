# Abyssal 测试规范

## 测试架构

```
项目根目录
├── src/
│   ├── core/
│   │   └── bibliography/
│   │       ├── index.ts              ← 实现
│   │       └── index.test.ts         ← 单元测试（就近放置）
│   ├── renderer/
│   │   └── core/store/
│   │       ├── useAppStore.ts
│   │       └── app-store.test.ts     ← 渲染进程测试（就近放置）
│   └── __test-utils__/               ← 共享测试工具库
│
└── tests/                            ← 独立测试目录
    ├── integration/                  ← 集成测试（跨模块 + 真实依赖）
    │   └── database-schema.test.ts
    └── e2e/                          ← E2E 测试（启动 Electron，暂不实施）
```

**放置原则**：

| 测试类型 | 放哪 | 理由 |
|---|---|---|
| 单元测试 | 被测文件旁边 | 属于某个具体模块，改模块时一眼可见 |
| 渲染进程测试 | 被测文件旁边 | 同上，前端生态惯例 |
| 集成测试 | `tests/integration/` | 跨多个模块，不属于任何单一模块 |
| E2E 测试 | `tests/e2e/` | 启动整个应用，完全独立于 src |

## 命令速查

| 命令 | 用途 |
|---|---|
| `npm test` | 运行所有测试（CI 用） |
| `npm run test:unit` | 仅运行单元测试 |
| `npm run test:integration` | 仅运行集成测试 |
| `npm run test:renderer` | 仅运行渲染进程测试 |
| `npm run test:watch` | watch 模式，保存自动重跑（开发推荐） |
| `npm run test:coverage` | 生成覆盖率报告 |

## 文件命名

- **单元测试**：`*.test.ts`，紧贴被测文件
- **集成测试**：`tests/integration/<描述性名称>.test.ts`
- **渲染进程测试**：`src/renderer/**/*.test.{ts,tsx}`
- **E2E 测试**：`tests/e2e/<场景名>.test.ts`（待实施）

## 三个测试项目

### 1. unit — 单元测试

**范围**：`src/core/**/*.test.ts` 和 `src/shared-types/**/*.test.ts`

**环境**：Node.js（无 DOM，无 Electron）

**原则**：
- 每个测试函数只测一件事
- 外部 I/O 全部 mock（网络、文件系统、LLM API）
- fetch 在 setup 中默认禁止，必须显式 stub
- 通过 `vi.mock()` 隔离被测模块的依赖

**什么时候写**：实现任何 `src/core/` 模块时，边写代码边写测试。

**示例**（类比 gtest）：
```ts
// gtest:
// TEST(BibliographyTest, ParseBibtex) {
//   auto entry = parseBibtex("@article{foo, author={Bar}}");
//   EXPECT_EQ(entry.author, "Bar");
// }

// vitest:
import { parseBibtex } from './index';

describe('parseBibtex', () => {
  it('should extract author', () => {
    const entry = parseBibtex('@article{foo, author={Bar}}');
    expect(entry.author).toBe('Bar');
  });
});
```

### 2. integration — 集成测试

**范围**：`tests/integration/**/*.test.ts`

**环境**：Node.js，`pool: 'forks'` 进程隔离

**原则**：
- 使用 `createTestDB()` 创建内存 SQLite，不写磁盘
- 可以串联多个 core 模块（如 search → process → database）
- LLM 调用仍然 mock（避免真实 API 费用和不确定性）
- HTTP 请求根据场景决定：mock 或使用录制的响应
- 超时 30 秒

**什么时候写**：当模块间的交互逻辑比单个模块内部逻辑更重要时。

**示例**：
```ts
// tests/integration/paper-ingestion.test.ts
import { createTestDB } from '@test-utils';

describe('paper ingestion pipeline', () => {
  let db: Database.Database;

  beforeEach(async () => { db = await createTestDB(); });
  afterEach(() => { db.close(); });

  it('should enforce FK constraints', () => {
    db.prepare("INSERT INTO papers (id, title) VALUES ('p1', 'Test')").run();
    expect(() => {
      db.prepare("INSERT INTO citations (citing_id, cited_id) VALUES ('p1', 'ghost')").run();
    }).toThrow();
  });
});
```

### 3. renderer — 渲染进程测试

**范围**：`src/renderer/**/*.test.{ts,tsx}`

**环境**：jsdom（模拟浏览器 DOM）

**原则**：
- `window.abyssal`（Electron preload API）在 setup 中自动 mock
- 优先测 Zustand store 逻辑（不渲染组件，更快更稳定）
- React 组件测试：只测关键交互路径，不测样式
- 避免测实现细节（不检查内部 state 结构，只检查行为）

**什么时候写**：实现 store 逻辑或关键 UI 交互时。

## 测试工具库 `@test-utils`

导入方式：`import { makePaper, createMockLLM } from '@test-utils';`

### Fixtures（数据工厂）

| 工厂函数 | 产出类型 | 用途 |
|---|---|---|
| `makePaper(overrides?)` | `PaperMetadata` | 创建测试论文 |
| `makeChunk(overrides?)` | `TextChunk` | 创建测试文本块 |
| `makeAnnotation(overrides?)` | `Annotation` | 创建测试标注 |
| `makeConcept(overrides?)` | `ConceptDefinition` | 创建测试概念 |
| `makeMapping(overrides?)` | `ConceptMapping` | 创建测试映射 |
| `resetFixtureSeq()` | — | 重置 ID 计数器 |

用法：
```ts
const paper = makePaper();                                // 最小默认值
const paper = makePaper({ title: 'My Paper', year: 2020 }); // 覆盖字段
const concept = makeConcept({ nameEn: 'Self-Regulation' }); // 关联对象
const mapping = makeMapping({ conceptId: concept.id });
```

### Mocks

| 工具 | 用途 |
|---|---|
| `createMockLLM()` | mock LLM client（complete + embed） |
| `createMockDB()` | mock 数据库（全部 CRUD 方法） |
| `createTestDB()` | 真实内存 SQLite（集成测试用） |

## Mock 策略速查

| 被测模块 | mock 什么 | 如何 mock |
|---|---|---|
| `bibliography` | 无（纯计算） | 不需要 mock |
| `process` | mupdf, tesseract.js | `vi.mock('mupdf')` |
| `search` | HTTP 请求 | `vi.mocked(fetch).mockResolvedValue(...)` |
| `llm-client` | API 调用 | `vi.mock('@anthropic-ai/sdk')` |
| `rag` | llm-client (embed) | `vi.mock('@core/llm-client')` + `createMockLLM()` |
| `database` | 无（用内存 SQLite） | `createTestDB()` |
| `orchestrator` | 所有下游模块 | 逐一 `vi.mock()` |
| `agent-loop` | llm-client | `createMockLLM()` |
| Zustand store | window.abyssal | setup-renderer.ts 已处理 |
| React 组件 | IPC hooks | `vi.mock('../core/ipc/hooks/usePapers')` |

## 编写规范

### 命名
- `describe` 块：模块名或类名
- `it` 块：`should + 动词 + 预期行为`

```ts
// ✓
describe('parseBibtex', () => {
  it('should extract author from @article entry', () => { ... });
  it('should return empty authors for malformed input', () => { ... });
});

// ✗
describe('test', () => {
  it('test1', () => { ... });
});
```

### 结构（Arrange-Act-Assert）

```ts
it('should filter papers by year range', () => {
  // Arrange
  const papers = [makePaper({ year: 2020 }), makePaper({ year: 2024 })];

  // Act
  const result = filterByYear(papers, 2022, 2025);

  // Assert
  expect(result).toHaveLength(1);
  expect(result[0].year).toBe(2024);
});
```

### 断言偏好

| 场景 | 推荐 | 避免 |
|---|---|---|
| 相等 | `toBe()` / `toEqual()` | `== true` |
| 包含 | `toContain()` | 手动 indexOf |
| 抛异常 | `toThrow()` | try-catch + flag |
| 异步 | `await expect(...).resolves` | `.then()` 链 |
| 近似值 | `toBeCloseTo()` | 手动 Math.abs |

### 每个模块实现时的测试清单

1. **正常路径**：给定合法输入，返回预期输出
2. **边界情况**：空数组、null/undefined、超长字符串、零值
3. **错误路径**：非法输入应抛出明确错误（不能静默失败）
4. **类型契约**：返回值的 shape 符合 TypeScript 类型

## CI 集成建议

```yaml
# GitHub Actions
test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 22 }
    - run: npm ci
    - run: npm run test:unit
    - run: npm run test:integration
    - run: npm run test:renderer
    - run: npm run test:coverage
```

执行顺序：unit → integration → renderer，从快到慢，尽早失败。
