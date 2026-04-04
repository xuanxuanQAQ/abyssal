import { describe, expect, it } from 'vitest';
import { parseCliArgs } from './cli-entry';

describe('parseCliArgs', () => {
  it('parses common batch arguments into the expected config', () => {
    const args = parseCliArgs([
      'node',
      'cli-entry.ts',
      '--stage', 'analyze',
      '--papers', 'p1,p2',
      '--concepts', 'c1,c2',
      '--workspace', 'C:/tmp/ws',
      '--config', 'C:/tmp/config.toml',
      '--concurrency', '5',
      '--article', 'article-1',
      '--dry-run',
      '--verbose',
    ]);

    expect(args).toEqual({
      stage: 'analyze',
      paperIds: ['p1', 'p2'],
      filter: null,
      conceptIds: ['c1', 'c2'],
      workspace: 'C:/tmp/ws',
      configPath: 'C:/tmp/config.toml',
      concurrency: 5,
      dryRun: true,
      verbose: true,
      articleId: 'article-1',
    });
  });

  it('falls back safely on invalid filter JSON and invalid concurrency', () => {
    const args = parseCliArgs([
      'node',
      'cli-entry.ts',
      '--filter', '{invalid-json}',
      '--concurrency', 'NaN',
    ]);

    expect(args.filter).toBeNull();
    expect(args.concurrency).toBe(3);
  });
});