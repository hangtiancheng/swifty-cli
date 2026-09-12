import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  Check,
  FileCode,
  FolderTree,
  GitBranch,
  LoaderCircle,
  Monitor,
  Network,
  PencilRuler,
  Search,
  SquareTerminal,
  Terminal,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  container,
  focusRing,
  gradientText,
  gridPattern,
  heading,
  line,
  muted,
} from "@/lib/styles";
import { Reveal } from "./ui/reveal";
import { Section, SectionHeader } from "./ui/section";

type Step =
  | { kind: "thinking"; text: string }
  | { kind: "tool"; name: string; arg: string }
  | { kind: "answer"; text: string };

interface Scene {
  prompt: string;
  steps: Step[];
  model: string;
  tokens: string;
  elapsed: string;
}

const SCENES: Scene[] = [
  {
    prompt: "Refactor token verification into a single helper",
    model: "claude-sonnet-4",
    tokens: "18.4k",
    elapsed: "6.1s",
    steps: [
      {
        kind: "thinking",
        text: "Scanning the auth module and every call site…",
      },
      { kind: "tool", name: "Grep", arg: '"verifyToken" · src' },
      { kind: "tool", name: "ReadFile", arg: "src/auth/session.ts" },
      { kind: "tool", name: "EditFile", arg: "src/auth/session.ts" },
      { kind: "tool", name: "Bash", arg: "pnpm test" },
      {
        kind: "answer",
        text: "Moved verification into a single verifyToken() helper, updated 4 call sites, and all 12 tests pass.",
      },
    ],
  },
  {
    prompt: "Where is the rate limiter configured?",
    model: "gpt-5-codex",
    tokens: "9.2k",
    elapsed: "3.4s",
    steps: [
      {
        kind: "thinking",
        text: "Locating the rate-limit middleware and its config…",
      },
      { kind: "tool", name: "Glob", arg: "src/**/*.ts" },
      { kind: "tool", name: "Grep", arg: '"rateLimit" · --type ts' },
      { kind: "tool", name: "ReadFile", arg: "src/middleware/limiter.ts" },
      {
        kind: "answer",
        text: "In src/middleware/limiter.ts — a sliding-window limiter backed by Redis, capped at 100 req/min per key.",
      },
    ],
  },
  {
    prompt: "Add a persisted dark mode toggle to settings",
    model: "claude-opus-4",
    tokens: "27.8k",
    elapsed: "9.7s",
    steps: [
      {
        kind: "thinking",
        text: "Reading the settings page and the theme provider…",
      },
      { kind: "tool", name: "ReadFile", arg: "src/settings/Appearance.tsx" },
      { kind: "tool", name: "EditFile", arg: "src/settings/Appearance.tsx" },
      { kind: "tool", name: "EditFile", arg: "src/theme/provider.tsx" },
      { kind: "tool", name: "Bash", arg: "pnpm typecheck" },
      {
        kind: "answer",
        text: "Added a persisted theme toggle wired into the existing provider. Typecheck is clean.",
      },
    ],
  },
  {
    prompt: "Audit the payments module in parallel",
    model: "claude-sonnet-4",
    tokens: "41.3k",
    elapsed: "22.6s",
    steps: [
      {
        kind: "thinking",
        text: "Spawning two teammates in isolated worktrees…",
      },
      { kind: "tool", name: "EnterWorktree", arg: "payments-audit" },
      { kind: "tool", name: "SpawnTeammate", arg: "security-auditor" },
      { kind: "tool", name: "SpawnTeammate", arg: "perf-auditor" },
      {
        kind: "answer",
        text: "Both auditors finished. 3 issues found — one critical (missing idempotency key). Full report attached.",
      },
    ],
  },
];

const TOOL_ICONS: Record<string, LucideIcon> = {
  Grep: Search,
  Glob: FolderTree,
  ReadFile: FileCode,
  EditFile: PencilRuler,
  Bash: Terminal,
  EnterWorktree: GitBranch,
  SpawnTeammate: Network,
};

const TABS = [
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
  { id: "browser", label: "Browser UI", icon: Monitor },
  { id: "print", label: "Print mode", icon: ArrowRight },
] as const;

type TabId = (typeof TABS)[number]["id"];

function ToolRow({
  step,
  live,
}: {
  step: Extract<Step, { kind: "tool" }>;
  live: boolean;
}) {
  const Icon = TOOL_ICONS[step.name] ?? Wrench;
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35 }}
      className="flex items-center gap-2.5 font-mono text-[12.5px] sm:text-[13px]"
    >
      <span
        className={cn(
          "grid h-5 w-5 shrink-0 place-items-center rounded-md",
          live
            ? "bg-brand-500/15 text-brand-600 dark:bg-brand-400/15 dark:text-brand-300"
            : "bg-emerald-500/12 text-emerald-600 dark:bg-emerald-400/12 dark:text-emerald-400",
        )}
      >
        {live ? (
          <LoaderCircle className="animate-spin-slow h-3 w-3" />
        ) : (
          <Check className="h-3 w-3" />
        )}
      </span>
      <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-400 dark:text-zinc-500" />
      <span className="font-semibold text-zinc-800 dark:text-zinc-200">
        {step.name}
      </span>
      <span className="truncate text-zinc-400 dark:text-zinc-500">
        {step.arg}
      </span>
    </motion.div>
  );
}

function TerminalPanel() {
  const [sceneIndex, setSceneIndex] = useState(0);
  const [visible, setVisible] = useState<Array<Step & { live?: boolean }>>(() =>
    SCENES[0].steps.map((step) => ({ ...step, live: false })),
  );
  const [typing, setTyping] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstRun = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    const run = async () => {
      // First paint already shows a finished session — hold it, then animate the rest.
      if (firstRun.current) {
        firstRun.current = false;
        await sleep(3800);
        if (!cancelled) setSceneIndex(1);
        return;
      }

      const scene = SCENES[sceneIndex];
      setVisible([]);
      setTyping("");
      await sleep(320);

      for (let i = 1; i <= scene.prompt.length; i++) {
        if (cancelled) return;
        setTyping(scene.prompt.slice(0, i));
        await sleep(30);
      }
      if (cancelled) return;
      setTyping(null);
      await sleep(460);

      for (let index = 0; index < scene.steps.length; index++) {
        if (cancelled) return;
        const step = scene.steps[index];
        setVisible((current) => [
          ...current,
          { ...step, live: step.kind === "tool" },
        ]);
        await sleep(step.kind === "tool" ? 720 : 1050);
        if (cancelled) return;
        setVisible((current) =>
          current.map((item, itemIndex) =>
            itemIndex === current.length - 1 ? { ...item, live: false } : item,
          ),
        );
        await sleep(160);
      }

      await sleep(4200);
      if (!cancelled) setSceneIndex((current) => (current + 1) % SCENES.length);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [sceneIndex]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [visible, typing]);

  const scene = SCENES[sceneIndex];

  return (
    <div className="relative">
      <div
        className={cn(
          "shadow-card overflow-hidden rounded-2xl border bg-white dark:bg-[#0b0b11] dark:shadow-none",
          line,
        )}
      >
        {/* window chrome */}
        <div
          className={cn(
            "flex items-center gap-3 border-b bg-zinc-50/80 px-4 py-3 dark:bg-white/[0.02]",
            line,
          )}
        >
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </div>
          <div className="flex flex-1 items-center justify-center gap-2 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
            <Terminal className="h-3 w-3" />
            swifty — ~/acme-api
          </div>
          <div className="hidden items-center gap-1.5 sm:flex">
            {SCENES.map((item, index) => (
              <button
                key={item.prompt}
                type="button"
                aria-label={`Scene ${index + 1}`}
                onClick={() => setSceneIndex(index)}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  index === sceneIndex
                    ? "bg-brand-500 w-5"
                    : "w-1.5 bg-zinc-300 hover:bg-zinc-400 dark:bg-zinc-700 dark:hover:bg-zinc-600",
                )}
              />
            ))}
          </div>
        </div>

        {/* body */}
        <div
          ref={scrollRef}
          className="h-[21rem] overflow-hidden px-4 py-5 font-mono text-[12.5px] leading-relaxed sm:h-[23rem] sm:px-5 sm:text-[13px]"
        >
          <div className="mb-4 flex items-center gap-2 text-[11px] text-zinc-400 dark:text-zinc-600">
            <span className="inline-flex h-4 items-center rounded bg-zinc-100 px-1.5 text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-400">
              swifty
            </span>
            <span>v0.0.28</span>
            <span>·</span>
            <span>model {scene.model}</span>
            <span>·</span>
            <span className="text-emerald-500">● ready</span>
          </div>

          <div className="flex items-start gap-2">
            <span className="text-brand-500 dark:text-brand-400 pt-0.5 select-none">
              ›
            </span>
            <span className="text-zinc-900 dark:text-zinc-100">
              {typing !== null ? typing : scene.prompt}
              {typing !== null ? (
                <span className="animate-blink bg-brand-500 dark:bg-brand-400 ml-0.5 inline-block h-[1.05em] w-[7px] translate-y-[2px]" />
              ) : null}
            </span>
          </div>

          <div className="mt-4 space-y-2.5">
            {visible.map((step, index) => {
              if (step.kind === "thinking") {
                return (
                  <motion.p
                    key={`${sceneIndex}-${index}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.4 }}
                    className="flex gap-2 pl-5 text-[12px] text-zinc-400 italic dark:text-zinc-500"
                  >
                    <span className="text-amber-400 not-italic">✻</span>
                    {step.text}
                  </motion.p>
                );
              }
              if (step.kind === "tool") {
                return (
                  <div key={`${sceneIndex}-${index}`} className="pl-5">
                    <ToolRow step={step} live={Boolean(step.live)} />
                  </div>
                );
              }
              return (
                <motion.p
                  key={`${sceneIndex}-${index}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45 }}
                  className="flex gap-2 pl-5 text-zinc-700 dark:text-zinc-300"
                >
                  <span className="text-brand-500 dark:text-brand-400">●</span>
                  <span className="font-sans text-[13px] leading-relaxed sm:text-sm">
                    {step.text}
                  </span>
                </motion.p>
              );
            })}
          </div>
        </div>

        {/* status bar */}
        <div
          className={cn(
            "flex items-center justify-between gap-3 border-t bg-zinc-50/80 px-4 py-2.5 font-mono text-[11px] text-zinc-400 dark:bg-white/[0.02] dark:text-zinc-500",
            line,
          )}
        >
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 text-emerald-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              acceptEdits
            </span>
            <span>sandbox on</span>
          </div>
          <div className="flex items-center gap-3">
            <span>{scene.tokens} tokens</span>
            <span>{scene.elapsed}</span>
            <span className="hidden sm:inline">
              Ctrl+O output · Shift+Tab mode
            </span>
          </div>
        </div>
      </div>

      <p className={cn("mt-4 text-center text-xs", muted)}>
        Illustrative session. Run <span className="font-mono">swifty</span> for
        the real thing.
      </p>
    </div>
  );
}

function BrowserPanel() {
  return (
    <div
      className={cn(
        "shadow-card overflow-hidden rounded-2xl border bg-white dark:bg-[#0b0b11] dark:shadow-none",
        line,
      )}
    >
      <div
        className={cn(
          "flex items-center gap-3 border-b bg-zinc-50/80 px-4 py-3 dark:bg-white/[0.02]",
          line,
        )}
      >
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 font-mono text-[11px] text-zinc-400 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-500">
          <span className="text-emerald-500">●</span>
          http://127.0.0.1:18888
        </div>
      </div>
      <div className="h-[21rem] space-y-4 overflow-hidden px-6 py-6 sm:h-[23rem]">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="bg-brand-600 dark:bg-brand-500 ml-auto max-w-[75%] rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm text-white"
        >
          Wire up the retry logic and show me the diff
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="max-w-[85%] space-y-3"
        >
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <span className="bg-brand-500/15 text-brand-500 grid h-5 w-5 place-items-center rounded-md">
              <Check className="h-3 w-3" />
            </span>
            EditFile · src/net/retry.ts
          </div>
          <div className="overflow-hidden rounded-xl border border-zinc-200 font-mono text-xs dark:border-white/10">
            <div className="bg-red-500/10 px-3 py-1 text-red-600 dark:text-red-400">
              - await fetch(url, opts)
            </div>
            <div className="bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-400">
              + await retry(() =&gt; fetch(url, opts), {"{ attempts: 3 }"})
            </div>
          </div>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Wrapped the request in a 3-attempt exponential backoff. Approve to
            write it?
          </p>
        </motion.div>
      </div>
    </div>
  );
}

const PRINT_LINES = [
  {
    text: 'swifty -p "fix the failing test" --output-format stream-json',
    tone: "cmd",
  },
  {
    text: '{"type":"stream_text","text":"Reading the test file…"}',
    tone: "text",
  },
  {
    text: '{"type":"tool_use","tool":"ReadFile","args":{"file_path":"test/api.test.ts"}}',
    tone: "tool",
  },
  { text: '{"type":"tool_result","isError":false,"output":"…"}', tone: "ok" },
  {
    text: '{"type":"tool_use","tool":"EditFile","args":{"file_path":"src/api.ts"}}',
    tone: "tool",
  },
  {
    text: '{"type":"stream_text","text":"Fixed the off-by-one in pagination."}',
    tone: "text",
  },
  {
    text: '{"type":"usage","input_tokens":8421,"output_tokens":512}',
    tone: "muted",
  },
  { text: '{"type":"loop_complete","stopReason":"end_turn"}', tone: "ok" },
] as const;

function PrintPanel() {
  return (
    <div
      className={cn(
        "shadow-card overflow-hidden rounded-2xl border bg-zinc-50 dark:bg-[#0b0b11] dark:shadow-none",
        "border-zinc-200 dark:border-white/10",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-3 border-b bg-white/60 px-4 py-3 dark:bg-white/[0.02]",
          "border-zinc-200 dark:border-white/[0.08]",
        )}
      >
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <div className="flex flex-1 items-center justify-center font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
          ci — stream-json
        </div>
      </div>
      <div className="h-[21rem] space-y-2 overflow-hidden px-5 py-5 font-mono text-[11.5px] leading-relaxed sm:h-[23rem] sm:text-[12.5px]">
        {PRINT_LINES.map((item, index) => (
          <motion.div
            key={item.text}
            initial={{ opacity: 0, x: -6 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.35, delay: index * 0.06 }}
            className={cn(
              "truncate",
              item.tone === "cmd" && "text-zinc-900 dark:text-zinc-100",
              item.tone === "text" && "text-sky-700 dark:text-sky-300/90",
              item.tone === "tool" && "text-brand-700 dark:text-brand-300",
              item.tone === "ok" && "text-emerald-600 dark:text-emerald-400",
              item.tone === "muted" && "text-zinc-400 dark:text-zinc-500",
            )}
          >
            {item.tone === "cmd" ? (
              <span className="text-brand-600 dark:text-brand-400">$ </span>
            ) : null}
            {item.text}
          </motion.div>
        ))}
        <div className="flex items-center gap-2 pt-2 text-zinc-400 dark:text-zinc-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          exit 0 · 0.9s
        </div>
      </div>
    </div>
  );
}

export function TerminalShowcase() {
  const [tab, setTab] = useState<TabId>("terminal");
  const active = useMemo(
    () => TABS.find((item) => item.id === tab) ?? TABS[0],
    [tab],
  );

  return (
    <Section id="showcase" className="overflow-hidden">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div
          className={cn(
            "absolute inset-0",
            gridPattern,
            "[mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,black,transparent)] [-webkit-mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,black,transparent)]",
          )}
        />
      </div>

      <SectionHeader
        eyebrow="See it work"
        title={
          <>
            One agent, <span className={gradientText}>every surface</span>
          </>
        }
        description="The same engine drives the terminal UI, a browser session over WebSocket, and a scriptable print mode for CI."
      />

      <Reveal delay={0.1} className={cn(container, "relative mt-12")}>
        <div className="mb-6 flex justify-center">
          <div
            className={cn(
              "inline-flex items-center gap-1 rounded-full border bg-white/70 p-1 backdrop-blur dark:bg-white/[0.03]",
              line,
            )}
            role="tablist"
            aria-label="Interface"
          >
            {TABS.map((item) => {
              const Icon = item.icon;
              const selected = item.id === tab;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setTab(item.id)}
                  className={cn(
                    "relative inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors sm:px-4",
                    focusRing,
                    selected
                      ? cn(heading)
                      : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-200",
                  )}
                >
                  {selected ? (
                    <motion.span
                      layoutId="showcase-tab"
                      className="absolute inset-0 rounded-full bg-zinc-100 shadow-sm dark:bg-white/[0.08]"
                      transition={{
                        type: "spring",
                        stiffness: 400,
                        damping: 32,
                      }}
                    />
                  ) : null}
                  <Icon className="relative h-3.5 w-3.5" />
                  <span className="relative">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={active.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            {tab === "terminal" ? <TerminalPanel /> : null}
            {tab === "browser" ? <BrowserPanel /> : null}
            {tab === "print" ? <PrintPanel /> : null}
          </motion.div>
        </AnimatePresence>
      </Reveal>
    </Section>
  );
}
