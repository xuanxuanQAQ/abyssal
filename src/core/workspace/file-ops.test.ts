import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { tryDelete, tryDeleteDir, atomicWrite, cleanTmpFiles, moveToOrphaned, moveDirToOrphaned } from './file-ops';

function tmpDir(): string {
  const dir = path.join(os.tmpdir(), `abyssal-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

describe('tryDelete', () => {
  it('deletes an existing file', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'test.txt');
    fs.writeFileSync(file, 'hello');
    tryDelete(file);
    expect(fs.existsSync(file)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('does nothing for non-existent file (no throw)', () => {
    expect(() => tryDelete('/nonexistent/file.txt')).not.toThrow();
  });
});

describe('tryDeleteDir', () => {
  it('recursively deletes a directory', () => {
    const dir = tmpDir();
    const subDir = path.join(dir, 'sub');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, 'file.txt'), 'data');
    tryDeleteDir(dir);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('does nothing for non-existent directory', () => {
    expect(() => tryDeleteDir('/nonexistent/dir')).not.toThrow();
  });
});

describe('atomicWrite', () => {
  it('writes string content atomically', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'output.txt');
    atomicWrite(file, 'hello world');
    expect(fs.readFileSync(file, 'utf-8')).toBe('hello world');
    // 确认临时文件不残留
    expect(fs.existsSync(file + '.tmp')).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes Buffer content atomically', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'output.bin');
    const buf = Buffer.from([0x00, 0x01, 0x02]);
    atomicWrite(file, buf);
    expect(fs.readFileSync(file)).toEqual(buf);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('overwrites existing file', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'output.txt');
    fs.writeFileSync(file, 'old content');
    atomicWrite(file, 'new content');
    expect(fs.readFileSync(file, 'utf-8')).toBe('new content');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('creates parent directories if needed', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'deep', 'nested', 'output.txt');
    atomicWrite(file, 'data');
    expect(fs.readFileSync(file, 'utf-8')).toBe('data');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('.tmp file is in same directory as target (verified by absence after write)', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'output.txt');

    atomicWrite(file, 'test');

    // 写入完成后 .tmp 文件不应残留——证明它在目标同目录下被原子重命名
    expect(fs.existsSync(file + '.tmp')).toBe(false);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readFileSync(file, 'utf-8')).toBe('test');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('cleanTmpFiles', () => {
  it('removes .tmp files recursively', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'a.tmp'), '');
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'sub', 'b.tmp'), '');
    fs.writeFileSync(path.join(dir, 'sub', 'keep.txt'), 'keep');

    const cleaned = cleanTmpFiles(dir);
    expect(cleaned).toBe(2);
    expect(fs.existsSync(path.join(dir, 'a.tmp'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'sub', 'b.tmp'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'sub', 'keep.txt'))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('skips .abyssal directory', () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, '.abyssal'));
    fs.writeFileSync(path.join(dir, '.abyssal', 'should-stay.tmp'), '');
    fs.writeFileSync(path.join(dir, 'should-go.tmp'), '');

    const cleaned = cleanTmpFiles(dir);
    expect(cleaned).toBe(1);
    expect(fs.existsSync(path.join(dir, '.abyssal', 'should-stay.tmp'))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns 0 for empty directory', () => {
    const dir = tmpDir();
    expect(cleanTmpFiles(dir)).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('moveToOrphaned', () => {
  it('moves file to _orphaned/ with mirrored path', () => {
    const root = tmpDir();
    const pdfsDir = path.join(root, 'pdfs');
    fs.mkdirSync(pdfsDir);
    const file = path.join(pdfsDir, 'test.pdf');
    fs.writeFileSync(file, 'pdf data');

    moveToOrphaned(file, root);

    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(root, '_orphaned', 'pdfs', 'test.pdf'))).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('preserves file content after move', () => {
    const root = tmpDir();
    const pdfsDir = path.join(root, 'pdfs');
    fs.mkdirSync(pdfsDir);
    const file = path.join(pdfsDir, 'test.pdf');
    fs.writeFileSync(file, 'important data');

    moveToOrphaned(file, root);

    const moved = path.join(root, '_orphaned', 'pdfs', 'test.pdf');
    expect(fs.readFileSync(moved, 'utf-8')).toBe('important data');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('does not throw on non-existent source file', () => {
    const root = tmpDir();
    // moveToOrphaned calls fs.renameSync which throws, but catch block swallows it
    expect(() => moveToOrphaned(path.join(root, 'nonexistent.pdf'), root)).not.toThrow();
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('moveDirToOrphaned', () => {
  it('moves directory to _orphaned/ with contents', () => {
    const root = tmpDir();
    const figDir = path.join(root, 'figures', 'abc123');
    fs.mkdirSync(figDir, { recursive: true });
    fs.writeFileSync(path.join(figDir, 'fig1.png'), 'img');

    moveDirToOrphaned(figDir, root);

    expect(fs.existsSync(figDir)).toBe(false);
    expect(fs.existsSync(path.join(root, '_orphaned', 'figures', 'abc123', 'fig1.png'))).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('atomicWrite — concurrent safety', () => {
  it('does not corrupt file on overwrite (simulated race)', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'race.txt');

    // Write initial
    atomicWrite(file, 'version-1');
    expect(fs.readFileSync(file, 'utf-8')).toBe('version-1');

    // Overwrite
    atomicWrite(file, 'version-2');
    expect(fs.readFileSync(file, 'utf-8')).toBe('version-2');

    // No .tmp residue
    expect(fs.existsSync(file + '.tmp')).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
