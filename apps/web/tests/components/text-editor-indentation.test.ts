import { describe, expect, it } from 'vitest';
import { indentTextSelection } from '../../src/components/text-editor-indentation';

describe('source editor indentation', () => {
  it('inserts spaces at a caret without replacing adjacent text', () => {
    expect(indentTextSelection('ab', 1, 1)).toEqual({ text: 'a  b', start: 3, end: 3 });
  });
  it('indents selected lines but leaves the next unselected line intact', () => {
    expect(indentTextSelection('a\nb\nc', 0, 4)).toEqual({ text: '  a\n  b\nc', start: 2, end: 8 });
  });
  it('outdents mixed tabs and spaces while keeping the selection valid', () => {
    expect(indentTextSelection('\ta\n b\nc', 0, 6, true)).toEqual({ text: 'a\nb\nc', start: 0, end: 4 });
  });
  it('outdents the current line from a collapsed caret', () => {
    expect(indentTextSelection('  abc', 4, 4, true)).toEqual({ text: 'abc', start: 2, end: 2 });
  });
});
