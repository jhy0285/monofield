const pendingWrites = new Map<string, Promise<void>>();

/** Serialize daemon writes so a content-hash check and its write share one turn. */
export async function withProjectFileWrite<T>(target: string, operation: () => Promise<T>): Promise<T> {
  const key = process.platform === 'win32' ? target.toLowerCase() : target;
  const previous = pendingWrites.get(key) ?? Promise.resolve();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  pendingWrites.set(key, pending);
  await previous;
  try { return await operation(); }
  finally {
    release();
    if (pendingWrites.get(key) === pending) pendingWrites.delete(key);
  }
}
