import { Box, renderToString, Text } from "ink";

import { version } from "../version.js";

import { CommittedMessage, type ChatMessage } from "./chat.js";
import { BORDER_COLORS } from "./styles.js";

// eslint-disable-next-line react-refresh/only-export-components
function Brand({ model, workDir }: { model: string; workDir: string }) {
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={BORDER_COLORS.focused}>{" /\\_/\\  "}</Text>
        <Text dimColor>Swifty v{version}</Text>
      </Text>
      <Text>
        <Text color={BORDER_COLORS.focused}>{"( o o ) "}</Text>
        <Text dimColor>{model}</Text>
      </Text>
      <Text>
        <Text color={BORDER_COLORS.focused}>{" >   <  "}</Text>
        <Text dimColor>{workDir}</Text>
      </Text>
      <Text> </Text>
    </Box>
  );
}

export const ERASE_VIEWPORT = "\x1b[2J\x1b[H";
export const ERASE_SCROLLBACK = "\x1b[2J\x1b[3J\x1b[H";

type Job =
  | { kind: "brand"; model: string; workDir: string }
  | { kind: "message"; message: ChatMessage; expanded: boolean }
  | { kind: "control"; data: string };

interface ScheduledTask {
  cancel: () => void;
}

export interface TranscriptRenderers {
  message: (message: ChatMessage, expanded: boolean, columns: number) => string;
  brand: (model: string, workDir: string, columns: number) => string;
}

export interface TranscriptQueueOptions {
  write: (data: string) => void;
  columns: () => number;
  schedule?: (task: () => void) => ScheduledTask;
  onError?: (err: unknown) => void;
  renderers?: TranscriptRenderers;
}

const defaultRenderers: TranscriptRenderers = {
  message: (message, expanded, columns) => {
    const output = renderToString(<CommittedMessage message={message} expanded={expanded} />, {
      columns,
    });
    return output ? output + "\n" : "";
  },
  brand: (model, workDir, columns) => {
    const output = renderToString(<Brand model={model} workDir={workDir} />, { columns });
    return output ? output + "\n" : "";
  },
};

function defaultSchedule(task: () => void): ScheduledTask {
  const handle = setImmediate(task);
  return {
    cancel: () => {
      clearImmediate(handle);
    },
  };
}

/**
 * Serial, deferred writer for finalized transcript output.
 *
 * Ink's renderToString shares the reconciler singleton with the live root and
 * frees its Yoga root as it returns. Calling it inside the live root's
 * render/commit/effect stack defers the nested sync flush past that free(),
 * so the delayed layout hits released WASM memory and crashes the process.
 * Every render therefore runs from a macrotask, which can never start inside
 * React's work loop.
 */
export class TranscriptQueue {
  private readonly options: TranscriptQueueOptions;
  private readonly renderers: TranscriptRenderers;
  private readonly schedule: (task: () => void) => ScheduledTask;
  private queue: Job[] = [];
  private scheduled: ScheduledTask | null = null;
  private cancelled = false;

  constructor(options: TranscriptQueueOptions) {
    this.options = options;
    this.renderers = options.renderers ?? defaultRenderers;
    this.schedule = options.schedule ?? defaultSchedule;
  }

  enqueueBrand(model: string, workDir: string): void {
    this.push([{ kind: "brand", model, workDir }]);
  }

  enqueueMessages(messages: readonly ChatMessage[], expanded: boolean): void {
    this.push(messages.map((message) => ({ kind: "message" as const, message, expanded })));
  }

  /**
   * Erasing supersedes anything still pending: those writes are exactly what a
   * following replay re-emits, so dropping them here avoids duplicates.
   */
  enqueueClear(opts: { scrollback?: boolean } = {}): void {
    this.queue = [];
    this.push([{ kind: "control", data: opts.scrollback ? ERASE_SCROLLBACK : ERASE_VIEWPORT }]);
  }

  enqueueReplay(messages: readonly ChatMessage[], expanded: boolean): void {
    this.enqueueClear();
    this.enqueueMessages(messages, expanded);
  }

  size(): number {
    return this.queue.length;
  }

  cancel(): void {
    this.cancelled = true;
    this.queue = [];
    this.scheduled?.cancel();
    this.scheduled = null;
  }

  private push(jobs: Job[]): void {
    if (this.cancelled || jobs.length === 0) {
      return;
    }
    this.queue.push(...jobs);
    this.scheduled ??= this.schedule(() => {
      this.scheduled = null;
      this.drain();
    });
  }

  private drain(): void {
    while (!this.cancelled) {
      const job = this.queue.shift();
      if (!job) {
        return;
      }
      try {
        const output = this.render(job);
        if (output) {
          this.options.write(output);
        }
      } catch (err) {
        this.options.onError?.(err);
      }
    }
  }

  private render(job: Job): string {
    if (job.kind === "control") {
      return job.data;
    }
    const columns = this.options.columns();
    return job.kind === "brand"
      ? this.renderers.brand(job.model, job.workDir, columns)
      : this.renderers.message(job.message, job.expanded, columns);
  }
}
