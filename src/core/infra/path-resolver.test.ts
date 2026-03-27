import { PathResolver } from './path-resolver';
import { ConfigError } from '../types/errors';
import type { WorkspaceConfig } from '../types/config';

function makeConfig(baseDir: string): WorkspaceConfig {
  return {
    baseDir,
    dbFileName: 'abyssal.db',
    pdfDir: 'pdfs',
    textDir: 'texts',
    reportsDir: 'reports',
    notesDir: 'notes',
    logsDir: 'logs',
    snapshotsDir: 'snapshots',
    privateDocsDir: 'private_docs',
  };
}

describe('PathResolver', () => {
  const resolver = new PathResolver(makeConfig('/workspace'));

  it('resolve joins baseDir and relative path with exact structure', () => {
    const result = resolver.resolve('pdfs/test.pdf');
    // Use path.sep-agnostic check: result must end with the expected segments
    expect(result).toMatch(/workspace[/\\]pdfs[/\\]test\.pdf$/);
  });

  it('resolvePdf generates correct path', () => {
    const result = resolver.resolvePdf('a1b2c3d4e5f6' as never);
    expect(result).toContain('pdfs');
    expect(result).toContain('a1b2c3d4e5f6.pdf');
  });

  it('resolveText generates correct path', () => {
    const result = resolver.resolveText('a1b2c3d4e5f6' as never);
    expect(result).toContain('texts');
    expect(result).toContain('a1b2c3d4e5f6.txt');
  });

  it('resolveAnalysis generates correct path', () => {
    const result = resolver.resolveAnalysis('a1b2c3d4e5f6' as never);
    expect(result).toContain('analyses');
    expect(result).toContain('a1b2c3d4e5f6.md');
  });

  it('resolveDecision generates correct path', () => {
    const result = resolver.resolveDecision('a1b2c3d4e5f6' as never);
    expect(result).toContain('decisions');
    expect(result).toContain('a1b2c3d4e5f6.md');
  });

  it('resolveFigureDir generates correct path', () => {
    const result = resolver.resolveFigureDir('a1b2c3d4e5f6' as never);
    expect(result).toContain('figures');
    expect(result).toContain('a1b2c3d4e5f6');
  });

  it('resolveArticleDir generates correct path', () => {
    const result = resolver.resolveArticleDir('my-article');
    expect(result).toContain('articles');
    expect(result).toContain('my-article');
  });

  it('resolvePrivateDoc generates correct path', () => {
    const result = resolver.resolvePrivateDoc('doc.md');
    expect(result).toContain('private_docs');
    expect(result).toContain('doc.md');
  });

  it('resolveNote generates correct path', () => {
    const result = resolver.resolveNote('my-note.md');
    expect(result).toContain('notes');
    expect(result).toContain('my-note.md');
  });

  it('throws ConfigError on path traversal', () => {
    expect(() => resolver.resolve('../../etc/passwd')).toThrow(ConfigError);
    expect(() => resolver.resolve('../../../root')).toThrow(ConfigError);
  });

  it('rejects absolute path as relative input on Windows', () => {
    if (process.platform !== 'win32') return;
    // Absolute path like C:\Windows resolves outside baseDir → traversal
    expect(() => resolver.resolve('C:\\Windows\\System32')).toThrow(ConfigError);
  });

  it('rejects absolute path as relative input on POSIX', () => {
    if (process.platform === 'win32') return;
    expect(() => resolver.resolve('/etc/passwd')).toThrow(ConfigError);
  });

  it('relative computes correct relative path', () => {
    // 构造一个绝对路径在 baseDir 内
    const abs = resolver.resolve('pdfs/test.pdf');
    const rel = resolver.relative(abs);
    expect(rel).toContain('pdfs');
    expect(rel).toContain('test.pdf');
  });
});

// Windows 路径长度检测
describe('PathResolver — Windows path length', () => {
  it('throws on paths > 250 chars on win32', () => {
    // 只在 win32 上测试此行为
    if (process.platform !== 'win32') return;

    // 构造一个很深的 baseDir
    const deepBase = 'C:\\' + 'A'.repeat(200);
    const config = makeConfig(deepBase);
    const resolver = new PathResolver(config);

    expect(() => resolver.resolve('articles/' + 'B'.repeat(60) + '/file.docx'))
      .toThrow(/[Pp]ath too long/);
  });
});
