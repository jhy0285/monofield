import { describe, expect, it } from 'vitest';
import { isAbsoluteFolder, readEnvLine, writeEnvLine } from '../../src/components/mcp-env-text';

describe('mcp env text', () => {
  it('reads one key without trimming what was typed', () => {
    const text = 'API_KEY=abc\n# note\nGHIDRA_INSTALL_DIR=C:\\Program Files\\ghidra \nOTHER=1';
    expect(readEnvLine(text, 'GHIDRA_INSTALL_DIR')).toBe('C:\\Program Files\\ghidra ');
    expect(readEnvLine(text, 'API_KEY')).toBe('abc');
    expect(readEnvLine(text, 'MISSING')).toBeUndefined();
    expect(readEnvLine(undefined, 'API_KEY')).toBeUndefined();
  });

  it('matches the key the way the form saves it: up to the first "=", surrounding spaces ignored', () => {
    expect(readEnvLine('  JAVA_HOME = /opt/jdk=21', 'JAVA_HOME')).toBe(' /opt/jdk=21');
    expect(readEnvLine('=nothing\nJAVA_HOME_2=/x', 'JAVA_HOME')).toBeUndefined();
  });

  it('replaces a key in place and leaves every other line alone', () => {
    const text = 'A=1\nJAVA_HOME=/old\n# keep me\nB=2';
    expect(writeEnvLine(text, 'JAVA_HOME', '/new')).toBe('A=1\nJAVA_HOME=/new\n# keep me\nB=2');
  });

  it('appends a missing key after the existing lines without piling up blank lines', () => {
    expect(writeEnvLine('A=1\n\n', 'JAVA_HOME', '/jdk')).toBe('A=1\nJAVA_HOME=/jdk');
    expect(writeEnvLine('', 'JAVA_HOME', '/jdk')).toBe('JAVA_HOME=/jdk');
    expect(writeEnvLine(undefined, 'JAVA_HOME', '/jdk')).toBe('JAVA_HOME=/jdk');
  });

  it('removes the key, duplicates included, when the value is empty or blank', () => {
    expect(writeEnvLine('A=1\nJAVA_HOME=/x\nJAVA_HOME=/y\nB=2', 'JAVA_HOME', '')).toBe('A=1\nB=2');
    expect(writeEnvLine('JAVA_HOME=/x', 'JAVA_HOME', '   ')).toBe('');
    expect(writeEnvLine('A=1', 'JAVA_HOME', '')).toBe('A=1');
  });

  it('keeps a value with spaces as typed so a path like "Program Files" can be entered key by key', () => {
    let text = '';
    for (const typed of ['C', 'C:', 'C:\\Program', 'C:\\Program ', 'C:\\Program Files']) text = writeEnvLine(text, 'GHIDRA_INSTALL_DIR', typed);
    expect(text).toBe('GHIDRA_INSTALL_DIR=C:\\Program Files');
    expect(readEnvLine(writeEnvLine('', 'GHIDRA_INSTALL_DIR', 'C:\\Program '), 'GHIDRA_INSTALL_DIR')).toBe('C:\\Program ');
  });

  it('knows a full path from a relative one', () => {
    for (const ok of ['/opt/ghidra', 'C:\\Tools\\ghidra', 'c:/tools/ghidra', '\\\\server\\share\\ghidra', '  /opt/x']) expect(isAbsoluteFolder(ok), ok).toBe(true);
    for (const bad of ['ghidra', './ghidra', '../ghidra', 'C:ghidra', '~/ghidra', '']) expect(isAbsoluteFolder(bad), bad).toBe(false);
  });
});
