import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  HardDrive,
  GitBranch,
  ShieldAlert,
  ShieldCheck,
  Lock,
  Wrench,
  ListTree,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";
import { permissionModes } from "../lib/content";
import {
  card,
  container,
  focusRing,
  heading,
  line,
  muted,
} from "../lib/styles";
import { Reveal } from "./ui/reveal";
import { Section, SectionHeader } from "./ui/section";

const MODE_ICON: Record<string, LucideIcon> = {
  default: Lock,
  acceptEdits: Wrench,
  plan: ListTree,
  bypassPermissions: Zap,
};

interface DialogView {
  chip: string;
  title: string;
  meta: string;
  rows: {
    label: string;
    value: string;
    tone: "allow" | "ask" | "deny" | "auto";
  }[];
  note: string;
}

const DIALOGS: Record<string, DialogView> = {
  default: {
    chip: "Permission required",
    title: "Bash",
    meta: "pnpm add drizzle-orm",
    rows: [
      { label: "Allow once", value: "Enter", tone: "allow" },
      { label: "Allow always", value: "A", tone: "auto" },
      { label: "Deny", value: "Esc", tone: "deny" },
    ],
    note: "Reads run freely. Writes and shell commands wait for you.",
  },
  acceptEdits: {
    chip: "Auto-accepted",
    title: "EditFile",
    meta: "src/db/schema.ts",
    rows: [
      { label: "Edit applied", value: "auto", tone: "auto" },
      { label: "Bash still asks", value: "ask", tone: "ask" },
      { label: "Deny rule wins", value: "deny", tone: "deny" },
    ],
    note: "File edits flow through; commands still pause for approval.",
  },
  plan: {
    chip: "Plan mode",
    title: "Read-only investigation",
    meta: "no writes will be made",
    rows: [
      { label: "ReadFile · Glob · Grep", value: "allow", tone: "allow" },
      { label: "WriteFile · EditFile", value: "ask", tone: "ask" },
      { label: "ExitPlanMode", value: "approve", tone: "auto" },
    ],
    note: "Explore and design first — approve the plan before anything changes.",
  },
  bypassPermissions: {
    chip: "Auto-allowed",
    title: "Bash",
    meta: "pnpm test -- --coverage",
    rows: [
      { label: "No prompts", value: "bypass", tone: "auto" },
      { label: "Full autonomy", value: "on", tone: "auto" },
      { label: "Deny rules still enforced", value: "deny", tone: "deny" },
    ],
    note: "For sandboxes, CI and disposable worktrees.",
  },
};

const TONE: Record<DialogView["rows"][number]["tone"], string> = {
  allow:
    "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  ask: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  deny: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
  auto: "border-brand-500/25 bg-brand-500/10 text-brand-700 dark:text-brand-300",
};

const SAFETY_FEATURES = [
  {
    icon: ShieldCheck,
    title: "OS-level sandbox",
    body: "Wrap command tools with seatbelt on macOS or bwrap on Linux, with optional auto-approval.",
  },
  {
    icon: ShieldAlert,
    title: "Glob allow / deny rules",
    body: "Rules like Bash(git push*) or ReadFile(secrets/*) decide before the model ever runs.",
  },
  {
    icon: GitBranch,
    title: "Worktree isolation",
    body: "Risky parallel work runs in its own git worktree, so your main tree stays clean.",
  },
];

export function Safety() {
  const [active, setActive] = useState(permissionModes[0].mode);
  const view = DIALOGS[active] ?? DIALOGS.default;

  return (
    <Section id="safety">
      <SectionHeader
        eyebrow="Guardrails"
        title={
          <>
            Safety that <span className="text-brand-500">you</span> dial in
          </>
        }
        description="Four permission modes, rule files and an optional OS sandbox. Swifty asks before it changes anything — until you tell it not to."
      />

      <div
        className={cn(
          container,
          "mt-14 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.05fr]",
        )}
      >
        <Reveal>
          <div className="flex flex-col gap-3">
            {permissionModes.map((mode) => {
              const Icon = MODE_ICON[mode.mode] ?? Lock;
              const selected = mode.mode === active;
              return (
                <button
                  key={mode.mode}
                  type="button"
                  onClick={() => setActive(mode.mode)}
                  className={cn(
                    "group relative overflow-hidden rounded-2xl border p-5 text-left transition-all duration-300",
                    focusRing,
                    selected
                      ? "border-brand-500/40 bg-brand-500/6 shadow-glow"
                      : cn(
                          line,
                          "bg-white hover:border-zinc-300 dark:bg-white/2 dark:hover:border-white/20",
                        ),
                  )}
                >
                  <div className="flex items-start gap-4">
                    <span
                      className={cn(
                        "grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-colors",
                        selected
                          ? "bg-brand-500 text-white"
                          : "bg-zinc-100 text-zinc-500 dark:bg-white/6 dark:text-zinc-400",
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "font-mono text-sm font-semibold",
                            heading,
                          )}
                        >
                          {mode.name}
                        </span>
                        {selected ? (
                          <span className="bg-brand-500/15 text-brand-600 dark:text-brand-300 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
                            selected
                          </span>
                        ) : null}
                      </div>
                      <p className={cn("mt-1 text-sm leading-relaxed", muted)}>
                        {mode.description}
                      </p>
                      <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-600">
                        {mode.detail}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className={cn("sticky top-24 overflow-hidden p-1", card)}>
            <div className="rounded-[0.9rem] bg-zinc-100 p-1.5 dark:bg-black/40">
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                <span className="ml-2 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                  swifty · approval
                </span>
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={active}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="rounded-xl bg-white p-5 dark:bg-[#0d0d14]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:border-white/10 dark:bg-white/4 dark:text-zinc-300">
                      <span className="bg-brand-500 dark:bg-brand-400 h-1.5 w-1.5 rounded-full" />
                      {view.chip}
                    </span>
                    <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                      {view.title}
                    </span>
                  </div>

                  <div className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-3 font-mono text-[12.5px] text-zinc-700 dark:border-white/10 dark:bg-black/40 dark:text-zinc-200">
                    <span className="text-brand-600 dark:text-brand-400">
                      ${" "}
                    </span>
                    {view.meta}
                  </div>

                  <ul className="mt-4 space-y-2">
                    {view.rows.map((row, index) => (
                      <motion.li
                        key={row.label}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, delay: index * 0.06 }}
                        className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 py-2 dark:border-white/6 dark:bg-white/2"
                      >
                        <span className="text-[13px] text-zinc-600 dark:text-zinc-300">
                          {row.label}
                        </span>
                        <span
                          className={cn(
                            "rounded-md border px-2 py-0.5 font-mono text-[11px]",
                            TONE[row.tone],
                          )}
                        >
                          {row.value}
                        </span>
                      </motion.li>
                    ))}
                  </ul>
                </motion.div>
              </AnimatePresence>
            </div>
            <p className={cn("px-4 py-3 text-center text-xs", muted)}>
              {view.note}
            </p>
          </div>
        </Reveal>
      </div>

      <div
        className={cn(container, "mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3")}
      >
        {SAFETY_FEATURES.map((feature, index) => (
          <Reveal key={feature.title} delay={index * 0.06}>
            <div
              className={cn(
                "h-full rounded-2xl border p-5 dark:bg-white/2",
                line,
              )}
            >
              <feature.icon className="text-brand-500 dark:text-brand-400 h-5 w-5" />
              <h3 className={cn("mt-4 text-sm font-semibold", heading)}>
                {feature.title}
              </h3>
              <p className={cn("mt-2 text-sm leading-relaxed", muted)}>
                {feature.body}
              </p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.1} className={cn(container, "mt-4")}>
        <div
          className={cn(
            "flex flex-wrap items-center justify-center gap-x-8 gap-y-3 rounded-2xl border bg-zinc-50/70 px-6 py-5 text-sm dark:bg-white/2",
            line,
          )}
        >
          <span className="inline-flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
            <HardDrive className="h-4 w-4 text-zinc-400" />
            Sessions, memory &amp; file history stay under
            <code className="font-mono text-xs text-zinc-700 dark:text-zinc-300">
              .swifty/
            </code>
          </span>
          <span className="inline-flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            Nothing leaves your machine but the model request
          </span>
        </div>
      </Reveal>
    </Section>
  );
}
