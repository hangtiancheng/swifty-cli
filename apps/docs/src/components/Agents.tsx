import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  GitBranch,
  Inbox,
  LoaderCircle,
  Check,
  Users,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { agentCards } from "@/lib/content";
import { card, container, heading, line, muted } from "@/lib/styles";
import { Reveal } from "./ui/reveal";
import { Section, SectionHeader } from "./ui/section";

const TEAM = [
  {
    name: "lead",
    model: "claude-sonnet-4",
    task: "coordinating",
    status: "lead" as const,
  },
  {
    name: "security-auditor",
    model: "claude-sonnet-4",
    task: "Auditing auth flows",
    status: "done" as const,
  },
  {
    name: "perf-auditor",
    model: "gpt-5-codex",
    task: "Tracing N+1 queries",
    status: "running" as const,
  },
  {
    name: "docs-writer",
    model: "claude-haiku-4",
    task: "Drafting the changelog",
    status: "running" as const,
  },
];

const MESSAGES = [
  { from: "lead", text: "audit src/payments for idempotency", tone: "to" },
  {
    from: "security-auditor",
    text: "found missing idempotency key → report",
    tone: "from",
  },
  {
    from: "perf-auditor",
    text: "2 N+1 queries in listInvoices()",
    tone: "from",
  },
];

export function Agents() {
  return (
    <Section id="agents" className="bg-zinc-50/60 dark:bg-white/1.5">
      <SectionHeader
        eyebrow="Multi-agent"
        title={
          <>
            One lead, <span className="text-brand-500">a whole team</span>
          </>
        }
        description="Spawn subagents for parallel work, coordinate them over file mailboxes and keep every risky task inside its own git worktree."
      />

      <div
        className={cn(
          container,
          "mt-14 grid grid-cols-1 gap-6 lg:grid-cols-[1.05fr_1fr]",
        )}
      >
        <Reveal>
          <div className="flex h-full flex-col gap-4">
            {agentCards.map((agent, index) => (
              <div
                key={agent.name}
                className={cn(
                  "group flex items-start gap-4 rounded-2xl border p-5 transition-colors dark:bg-white/[0.02]",
                  line,
                  "hover:border-brand-500/40 hover:bg-brand-500/[0.04]",
                )}
              >
                <span className="bg-brand-500/12 text-brand-600 dark:bg-brand-400/12 dark:text-brand-300 grid h-11 w-11 shrink-0 place-items-center rounded-xl">
                  <agent.icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn("font-mono text-sm font-semibold", heading)}
                    >
                      {agent.name}
                    </span>
                    <span className="rounded-full border border-zinc-200/80 px-2 py-0.5 text-[10px] font-medium tracking-wide text-zinc-500 uppercase dark:border-white/[0.08] dark:text-zinc-400">
                      {agent.role}
                    </span>
                  </div>
                  <p className={cn("mt-1.5 text-sm leading-relaxed", muted)}>
                    {agent.description}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {agent.tools.map((tool) => (
                      <span
                        key={tool}
                        className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-[10px] text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-400"
                      >
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
                <span className="hidden self-center text-xs text-zinc-400 sm:block">
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
            ))}

            <div
              className={cn(
                "rounded-2xl border p-5 dark:bg-white/[0.02]",
                line,
              )}
            >
              <div className="flex items-center gap-3">
                <Workflow className="text-brand-500 h-5 w-5" />
                <h3 className={cn("text-sm font-semibold", heading)}>
                  Custom agents
                </h3>
              </div>
              <p className={cn("mt-2 text-sm leading-relaxed", muted)}>
                Define your own agents as Markdown files with YAML front-matter
                in{" "}
                <code className="font-mono text-xs text-zinc-700 dark:text-zinc-300">
                  .swifty/agents/
                </code>
                . Pick the tools, model and permission mode each one gets.
              </p>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.12}>
          <div className={cn("overflow-hidden", card)}>
            <div
              className={cn(
                "flex items-center justify-between gap-3 border-b px-5 py-4",
                line,
              )}
            >
              <div className="flex items-center gap-2.5">
                <span className="bg-brand-500/12 text-brand-600 dark:bg-brand-400/12 dark:text-brand-300 grid h-8 w-8 place-items-center rounded-lg">
                  <Users className="h-4 w-4" />
                </span>
                <div>
                  <p className={cn("font-mono text-sm font-semibold", heading)}>
                    team: payments-audit
                  </p>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    {TEAM.length} members · in-process
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/12 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                live
              </span>
            </div>

            <ul className="space-y-1 px-3 py-4">
              {TEAM.map((member, index) => (
                <motion.li
                  key={member.name}
                  initial={{ opacity: 0, x: -8 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: index * 0.08 }}
                  className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-zinc-50 dark:hover:bg-white/[0.03]"
                >
                  <span
                    className={cn(
                      "ml-1 h-1.5 w-1.5 shrink-0 rounded-full",
                      member.status === "lead" && "bg-brand-500",
                      member.status === "done" && "bg-emerald-500",
                      member.status === "running" && "bg-amber-400",
                    )}
                  />
                  <span className="w-32 shrink-0 truncate font-mono text-[12.5px] text-zinc-800 dark:text-zinc-200">
                    {member.name}
                  </span>
                  <span className="hidden flex-1 truncate text-[12px] text-zinc-400 sm:block dark:text-zinc-500">
                    {member.task}
                  </span>
                  <span className="ml-auto font-mono text-[10.5px] text-zinc-400 dark:text-zinc-600">
                    {member.model}
                  </span>
                  <span className="grid h-5 w-5 shrink-0 place-items-center">
                    {member.status === "running" ? (
                      <LoaderCircle className="animate-spin-slow h-3.5 w-3.5 text-amber-500" />
                    ) : (
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                    )}
                  </span>
                </motion.li>
              ))}
            </ul>

            <div className={cn("border-t px-5 py-4", line)}>
              <div className="flex items-center gap-2 text-[11px] font-medium tracking-wide text-zinc-400 uppercase dark:text-zinc-500">
                <Inbox className="h-3.5 w-3.5" />
                mailbox
              </div>
              <div className="mt-3 space-y-2">
                <AnimatePresence initial={false}>
                  {MESSAGES.map((message, index) => (
                    <motion.div
                      key={message.text}
                      initial={{ opacity: 0, y: 6 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.4, delay: index * 0.12 }}
                      className={cn(
                        "flex items-start gap-2 rounded-lg border px-3 py-2 font-mono text-[11.5px]",
                        message.tone === "to"
                          ? "border-brand-500/20 bg-brand-500/[0.06] text-brand-700 dark:text-brand-300"
                          : cn(
                              line,
                              "bg-zinc-50/70 text-zinc-600 dark:bg-white/[0.02] dark:text-zinc-400",
                            ),
                      )}
                    >
                      <ArrowRight
                        className={cn(
                          "mt-0.5 h-3 w-3 shrink-0",
                          message.tone === "to"
                            ? "text-brand-500"
                            : "rotate-180 text-emerald-500",
                        )}
                      />
                      <span className="font-semibold">{message.from}:</span>
                      <span className="min-w-0 flex-1">{message.text}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>

            <div
              className={cn(
                "flex items-center justify-between gap-3 border-t bg-zinc-50/70 px-5 py-3 text-[11px] text-zinc-400 dark:bg-white/[0.02] dark:text-zinc-500",
                line,
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                <GitBranch className="h-3.5 w-3.5" />2 worktrees
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Inbox className="h-3.5 w-3.5" />2 mailboxes
              </span>
              <span className="font-mono">Ctrl+T teams</span>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
