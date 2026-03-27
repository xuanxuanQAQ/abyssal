import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  distributeCslFiles,
  validateCslFile,
  listAvailableStyles,
  invalidateStylesCache,
  resolveLocale,
  extractDraftCitationIds,
  renderDraftCitations,
  reRenderDraftCitations,
} from './csl-manager';

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `abyssal-csl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── distributeCslFiles ───

describe('distributeCslFiles', () => {
  it('copies files from resources to workspace', () => {
    const src = tmpDir();
    const dest = tmpDir();
    fs.mkdirSync(path.join(src, 'styles'), { recursive: true });
    fs.writeFileSync(path.join(src, 'styles', 'apa.csl'), '<style>APA</style>');

    const copied = distributeCslFiles(src, dest);
    expect(copied).toBe(1);
    expect(fs.readFileSync(path.join(dest, 'styles', 'apa.csl'), 'utf-8')).toBe('<style>APA</style>');

    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  });

  it('does not overwrite existing files', () => {
    const src = tmpDir();
    const dest = tmpDir();
    fs.mkdirSync(path.join(src, 'styles'), { recursive: true });
    fs.mkdirSync(path.join(dest, 'styles'), { recursive: true });
    fs.writeFileSync(path.join(src, 'styles', 'apa.csl'), 'new version');
    fs.writeFileSync(path.join(dest, 'styles', 'apa.csl'), 'user modified');

    distributeCslFiles(src, dest);
    expect(fs.readFileSync(path.join(dest, 'styles', 'apa.csl'), 'utf-8')).toBe('user modified');

    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  });

  it('returns 0 for nonexistent resources dir', () => {
    expect(distributeCslFiles('/nonexistent', tmpDir())).toBe(0);
  });
});

// ─── validateCslFile ───

describe('validateCslFile', () => {
  it('accepts valid CSL file', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'test.csl');
    fs.writeFileSync(file, '<?xml version="1.0"?><style xmlns="http://purl.org/net/xbiblio/csl"><title>Test</title></style>');
    expect(validateCslFile(file)).toEqual({ valid: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects file without <style> element', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'bad.csl');
    fs.writeFileSync(file, '<?xml version="1.0"?><root>not a style</root>');
    const result = validateCslFile(file);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('<style>');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejects nonexistent file', () => {
    const result = validateCslFile('/nonexistent.csl');
    expect(result.valid).toBe(false);
  });
});

// ─── listAvailableStyles ───

describe('listAvailableStyles', () => {
  beforeEach(() => invalidateStylesCache());

  it('discovers CSL files and extracts display names', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'apa.csl'), '<style><title>American Psychological Association 7th edition</title></style>');
    fs.writeFileSync(path.join(dir, 'ieee.csl'), '<style><title>IEEE</title></style>');
    fs.writeFileSync(path.join(dir, 'not-csl.txt'), 'ignored');

    const styles = listAvailableStyles(dir);
    expect(styles).toHaveLength(2);
    expect(styles[0]!.displayName).toBe('American Psychological Association 7th edition');
    expect(styles[0]!.styleId).toBe('apa');
    expect(styles[1]!.styleId).toBe('ieee');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('uses styleId as fallback display name', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'custom.csl'), '<style></style>'); // no <title>
    const styles = listAvailableStyles(dir);
    expect(styles[0]!.displayName).toBe('custom');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns empty for nonexistent directory', () => {
    expect(listAvailableStyles('/nonexistent')).toEqual([]);
  });

  it('caches results', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'a.csl'), '<style><title>A</title></style>');

    const first = listAvailableStyles(dir);
    // 添加新文件——缓存应返回旧结果
    fs.writeFileSync(path.join(dir, 'b.csl'), '<style><title>B</title></style>');
    const second = listAvailableStyles(dir);
    expect(second).toHaveLength(1); // 缓存，不重新扫描

    invalidateStylesCache();
    const third = listAvailableStyles(dir);
    expect(third).toHaveLength(2); // 缓存失效后重新扫描
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ─── resolveLocale ───

describe('resolveLocale', () => {
  let localesDir: string;

  beforeEach(() => {
    localesDir = tmpDir();
    fs.writeFileSync(path.join(localesDir, 'locales-en-US.xml'), '<locale>en-US</locale>');
    fs.writeFileSync(path.join(localesDir, 'locales-zh-CN.xml'), '<locale>zh-CN</locale>');
    fs.writeFileSync(path.join(localesDir, 'locales-zh-TW.xml'), '<locale>zh-TW</locale>');
  });

  afterEach(() => {
    fs.rmSync(localesDir, { recursive: true, force: true });
  });

  it('exact match', () => {
    expect(resolveLocale('zh-CN', localesDir)).toBe('<locale>zh-CN</locale>');
  });

  it('fallback: strip region → scan same language', () => {
    // 请求 zh-HK（不存在），应回退到 zh-CN（同语言字典序首个）
    const result = resolveLocale('zh-HK', localesDir);
    expect(result).toBe('<locale>zh-CN</locale>');
  });

  it('fallback to en-US when language not found', () => {
    const result = resolveLocale('xx-YY', localesDir);
    expect(result).toBe('<locale>en-US</locale>');
  });

  it('returns null when en-US also missing', () => {
    const emptyDir = tmpDir();
    expect(resolveLocale('xx', emptyDir)).toBeNull();
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });
});

// ─── Draft citations ───

describe('extractDraftCitationIds', () => {
  it('extracts paperIds from dual-format citations', () => {
    const text = 'See [[@a1b2c3d4e5f6]](Goffman, 1959) and [[@b2c3d4e5f6a7]](Norman, 2013).';
    const ids = extractDraftCitationIds(text);
    expect(ids).toEqual(['a1b2c3d4e5f6', 'b2c3d4e5f6a7']);
  });

  it('deduplicates ids', () => {
    const text = '[[@aaaaaaaaaaaa]](A) and [[@aaaaaaaaaaaa]](A)';
    expect(extractDraftCitationIds(text)).toEqual(['aaaaaaaaaaaa']);
  });

  it('returns empty for no citations', () => {
    expect(extractDraftCitationIds('No citations here.')).toEqual([]);
  });

  it('does not match plain [@id] format', () => {
    expect(extractDraftCitationIds('[@a1b2c3d4e5f6]')).toEqual([]);
  });

  it('does not match IDs shorter than 12 hex chars', () => {
    expect(extractDraftCitationIds('[[@a1b2c3]](Short)')).toEqual([]);
  });

  it('does not match IDs with non-hex chars', () => {
    expect(extractDraftCitationIds('[[@g1h2i3j4k5l6]](Bad hex)')).toEqual([]);
  });

  it('handles nested brackets gracefully', () => {
    const text = '[[@a1b2c3d4e5f6]](Author (2020))';
    // The regex [[@id]](text) matches up to first closing paren
    const ids = extractDraftCitationIds(text);
    expect(ids).toEqual(['a1b2c3d4e5f6']);
  });

  it('handles empty string input', () => {
    expect(extractDraftCitationIds('')).toEqual([]);
  });
});
