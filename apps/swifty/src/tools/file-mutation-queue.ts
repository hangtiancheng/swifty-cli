import { realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const queues = new Map<string, Promise<void>>();

async function canonicalPath(filePath: string): Promise<string> {
  const absolutePath = resolve(filePath);
  try {
    return await realpath(absolutePath);
  } catch {
    try {
      return join(await realpath(dirname(absolutePath)), basename(absolutePath));
    } catch {
      return absolutePath;
    }
  }
}

/** Serialize mutations targeting the same resolved path. */
export async function withFileMutationQueue<T>(
  filePath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = await canonicalPath(filePath);
  const previous = queues.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => next);
  queues.set(key, queued);

  return previous.then(operation).finally(() => {
    release();
    if (queues.get(key) === queued) {
      queues.delete(key);
    }
  });
}
