import { motion } from "motion/react";
import { ArrowRight, Sparkles, Star } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  INSTALL_METHODS,
  QUICK_COMMANDS,
  REPO_URL,
  VERSION,
  stats,
} from "@/lib/content";
import {
  container,
  focusRing,
  gradientText,
  gridPattern,
  heading,
  muted,
  primaryButton,
  secondaryButton,
} from "@/lib/styles";
import { CommandBar } from "./ui/command-box";
import { GithubIcon } from "./ui/github-icon";
import { EASE } from "./ui/reveal";

const parent = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};

const child = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: EASE } },
};

export function Hero({ docsUrl }: { docsUrl: string }) {
  const install = INSTALL_METHODS[0].command;

  return (
    <section
      id="top"
      className="relative overflow-hidden pt-36 pb-20 sm:pt-44 sm:pb-28"
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div
          className={cn(
            "absolute inset-0",
            gridPattern,
            "[mask-image:radial-gradient(ellipse_65%_55%_at_50%_0%,black,transparent)] [-webkit-mask-image:radial-gradient(ellipse_65%_55%_at_50%_0%,black,transparent)]",
          )}
        />
        <div className="animate-drift bg-brand-500/20 dark:bg-brand-600/25 absolute -top-52 left-1/2 h-[34rem] w-[64rem] -translate-x-1/2 rounded-full blur-[130px]" />
        <div className="animate-floaty bg-accent-400/20 dark:bg-accent-500/15 absolute top-32 -right-40 h-[26rem] w-[26rem] rounded-full blur-[120px]" />
        <div className="animate-floaty bg-brand-400/15 absolute top-64 -left-32 h-[22rem] w-[22rem] rounded-full blur-[120px] [animation-delay:1.5s]" />
      </div>

      <motion.div
        variants={parent}
        initial="hidden"
        animate="show"
        className={cn(container, "relative text-center")}
      >
        <motion.div variants={child} className="flex justify-center">
          <a
            href={docsUrl}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "group border-brand-500/20 bg-brand-500/[0.07] text-brand-700 hover:border-brand-500/40 hover:bg-brand-500/[0.12] dark:border-brand-300/20 dark:bg-brand-400/[0.09] dark:text-brand-200 inline-flex flex-wrap items-center justify-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium backdrop-blur transition-colors sm:text-[13px]",
              focusRing,
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="font-semibold">{VERSION} is out</span>
            <span className="opacity-80">
              — multi-agent teams, MCP &amp; sandboxing
            </span>
            <span className="inline-flex items-center gap-1 font-semibold">
              Read the docs
              <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
            </span>
          </a>
        </motion.div>

        <motion.h1
          variants={child}
          className={cn(
            "mx-auto mt-8 max-w-4xl text-4xl leading-[1.05] font-semibold tracking-[-0.04em] text-balance sm:text-6xl md:text-7xl",
            heading,
          )}
        >
          The <span className={gradientText}>coding agent</span>
          <br className="hidden sm:block" /> that lives in your terminal
        </motion.h1>

        <motion.p
          variants={child}
          className={cn(
            "mx-auto mt-6 max-w-2xl text-base leading-relaxed text-pretty sm:text-lg",
            muted,
          )}
        >
          Swifty connects to any LLM, edits files, runs commands and
          orchestrates multi-agent workflows — all from a single CLI that stays
          out of your way.
        </motion.p>

        <motion.div variants={child} className="mx-auto mt-9 max-w-xl">
          <CommandBar command={install} leading="curl" />
        </motion.div>

        <motion.div
          variants={child}
          className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <a
            href="#install"
            className={cn(primaryButton, "w-full sm:w-auto", focusRing)}
          >
            Get started
            <ArrowRight className="h-4 w-4" />
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className={cn(secondaryButton, "w-full sm:w-auto", focusRing)}
          >
            <GithubIcon className="h-4 w-4" />
            Star on GitHub
            <Star className="h-3.5 w-3.5 text-amber-400" />
          </a>
        </motion.div>

        <motion.ul
          variants={child}
          className="mt-10 flex flex-wrap items-center justify-center gap-2"
        >
          {QUICK_COMMANDS.map((item) => (
            <li
              key={item.command}
              className="flex items-center gap-2 rounded-full border border-zinc-200/80 bg-white/60 px-3 py-1.5 font-mono text-[11px] text-zinc-600 backdrop-blur sm:text-xs dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-zinc-400"
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  item.tone === "brand" && "bg-brand-500",
                  item.tone === "accent" && "bg-accent-400",
                  item.tone === "neutral" && "bg-zinc-400 dark:bg-zinc-600",
                )}
              />
              <span className="text-zinc-400 dark:text-zinc-500">
                {item.command}
              </span>
              <span className="text-zinc-300 dark:text-zinc-700">·</span>
              <span>{item.label}</span>
            </li>
          ))}
        </motion.ul>

        <motion.dl
          variants={child}
          className="mx-auto mt-14 grid max-w-3xl grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4"
        >
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col items-center gap-1">
              <dt
                className={cn(
                  "text-3xl font-semibold tracking-tight sm:text-4xl",
                  heading,
                )}
              >
                {stat.value}
              </dt>
              <dd className="text-xs font-medium tracking-[0.14em] text-zinc-400 uppercase dark:text-zinc-500">
                {stat.label}
              </dd>
            </div>
          ))}
        </motion.dl>
      </motion.div>
    </section>
  );
}
