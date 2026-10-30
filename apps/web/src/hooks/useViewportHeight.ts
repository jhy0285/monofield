'use client';

import { useEffect, useState } from 'react';

/** The window's inner height, kept current on resize. `fallback` is used until mount. */
export function useViewportHeight(fallback = 800): number {
  const [height, setHeight] = useState(fallback);
  useEffect(() => {
    const update = () => setHeight(window.innerHeight);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return height;
}
