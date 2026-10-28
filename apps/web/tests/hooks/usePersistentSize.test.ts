// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePersistentSize } from '../../src/hooks/usePersistentSize';

const KEY = 'monofield:layout:test-size';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('usePersistentSize', () => {
  it('starts without a stored size and reads a saved one after mount', () => {
    const empty = renderHook(() => usePersistentSize(KEY));
    expect(empty.result.current.stored).toBeNull();
    empty.unmount();

    window.localStorage.setItem(KEY, '312');
    const saved = renderHook(() => usePersistentSize(KEY));
    expect(saved.result.current.stored).toBe(312);
  });

  it('ignores a saved value that is not a positive number', () => {
    for (const raw of ['', 'abc', '-40', '0', 'NaN', 'Infinity']) {
      window.localStorage.setItem(KEY, raw);
      const { result, unmount } = renderHook(() => usePersistentSize(KEY));
      expect(result.current.stored, raw).toBeNull();
      unmount();
    }
  });

  it('previews a size without saving it, and saves it on commit', () => {
    const { result } = renderHook(() => usePersistentSize(KEY));

    act(() => result.current.preview(280.6));
    expect(result.current.stored).toBe(281);
    expect(window.localStorage.getItem(KEY)).toBeNull();

    act(() => result.current.commit(284));
    expect(result.current.stored).toBe(284);
    expect(window.localStorage.getItem(KEY)).toBe('284');
  });

  it('forgets the saved size on reset', () => {
    window.localStorage.setItem(KEY, '300');
    const { result } = renderHook(() => usePersistentSize(KEY));
    expect(result.current.stored).toBe(300);

    act(() => result.current.reset());
    expect(result.current.stored).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('still works when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => usePersistentSize(KEY));
    expect(result.current.stored).toBeNull();

    act(() => result.current.commit(250));
    expect(result.current.stored).toBe(250);
    act(() => result.current.reset());
    expect(result.current.stored).toBeNull();
  });
});
