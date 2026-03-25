/**
 * IPC 集成冒烟测试
 *
 * 不启动 Electron，直接测试 IPC handler 的核心逻辑：
 * - DB 初始化
 * - BibTeX 导入实际写入 DB
 * - 查询返回导入的数据
 *
 * 使用真实 SQLite（内存模式不支持迁移需要的 __dirname，所以用临时文件）
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createDatabaseService, type DatabaseService } from '@core/database';
import { createBibliographyService, type BibliographyService } from '@core/bibliography';
import { ConsoleLogger } from '@core/infra/logger';
import type { PaperMetadata } from '@core/types/paper';

const logger = new ConsoleLogger('warn');
let dbService: DatabaseService;
let biblioService: BibliographyService;
let tmpDir: string;

const SAMPLE_BIB = `
@article{vaswani2017attention,
  title={Attention Is All You Need},
  author={Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},
  year={2017},
  journal={NeurIPS},
  doi={10.48550/arXiv.1706.03762}
}
@inproceedings{devlin2019bert,
  title={BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding},
  author={Devlin, Jacob and Chang, Ming-Wei and Lee, Kenton},
  year={2019},
  booktitle={NAACL-HLT}
}
`;

const minConfig = {
  workspace: { baseDir: '', dbFileName: 'test.db' },
  rag: { embeddingDimension: 384 },
  bibliography: { defaultStyle: 'apa', stylesDir: '' },
  apiKeys: { openalexEmail: null },
} as any;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'abyssal-ipc-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const migrationsDir = path.resolve(__dirname, '../../src/core/database/migrations');

  dbService = createDatabaseService({
    dbPath,
    config: minConfig,
    logger,
    skipVecExtension: true,
    migrationsDir,
  });

  biblioService = createBibliographyService(minConfig, logger);
});

afterAll(() => {
  try { dbService?.close(); } catch { /* ignore */ }
  try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
});

describe('IPC smoke: BibTeX import → query pipeline', () => {
  it('importBibtex parses entries from raw BibTeX string', () => {
    const entries = biblioService.importBibtex(SAMPLE_BIB);
    expect(entries.length).toBe(2);
    expect(entries[0]!.metadata.title).toContain('Attention');
    expect(entries[1]!.metadata.title).toContain('BERT');
  });

  it('addPaper writes to database', () => {
    const entries = biblioService.importBibtex(SAMPLE_BIB);
    let imported = 0;
    for (const entry of entries) {
      try {
        dbService.addPaper(entry.metadata as PaperMetadata);
        imported++;
      } catch {
        // duplicate on re-run
      }
    }
    expect(imported).toBeGreaterThanOrEqual(1);
  });

  it('queryPapers returns imported papers', () => {
    const result = dbService.queryPapers({});
    expect(result.items.length).toBeGreaterThanOrEqual(2);

    const titles = result.items.map(p => p.title);
    expect(titles.some(t => t.includes('Attention'))).toBe(true);
    expect(titles.some(t => t.includes('BERT'))).toBe(true);
  });

  it('getPaper returns a single paper by ID', () => {
    const result = dbService.queryPapers({});
    const firstId = result.items[0]!.id;
    const paper = dbService.getPaper(firstId);
    expect(paper).not.toBeNull();
    expect(paper!.id).toBe(firstId);
  });

  it('getStats reflects correct paper count', () => {
    const stats = dbService.getStats();
    expect(stats.papers.total).toBeGreaterThanOrEqual(2);
  });

  it('deletePaper removes the paper', () => {
    const result = dbService.queryPapers({});
    const countBefore = result.items.length;
    const idToDelete = result.items[result.items.length - 1]!.id;

    dbService.deletePaper(idToDelete);

    const after = dbService.queryPapers({});
    expect(after.items.length).toBe(countBefore - 1);
  });
});
