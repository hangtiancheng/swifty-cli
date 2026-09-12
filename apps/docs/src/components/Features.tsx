import { useRef } from "react";
import type { MouseEvent, ReactNode } from "react";
import { Bot, ShieldCheck, Sparkle } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  agentCards,
  features,
  permissionModes,
  providerList,
} from "@/lib/content";
import type { Feature } from "@/lib/content";
import {
  card,
  cardHover,
  chip,
  container,
  heading,
  line,
  muted,
} from "@/lib/styles";
import { Reveal } from "./ui/reveal";
import { Section, SectionHeader } from "./ui/section";

function SpotlightCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (event: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
    el.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      className={cn(
        "group relative overflow-hidden",
        card,
        cardHover,
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(260px_circle_at_var(--spot-x,50%)_var(--spot-y,50%),rgba(132,154,114,0.16),transparent_70%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative h-full">{children}</div>
    </div>
  );
}

const ACCENT_TILE: Record<NonNullable<Feature["accent"]>, string> = {
  brand:
    "bg-brand-500/12 text-brand-600 dark:bg-brand-400/12 dark:text-brand-300",
  accent:
    "bg-accent-500/12 text-accent-600 dark:bg-accent-400/12 dark:text-accent-300",
  neutral:
    "bg-zinc-900/[0.05] text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300",
};

function Decor({ kind }: { kind: NonNullable<Feature["decor"]> }) {
  if (kind === "providers") {
    return (
      <div className="mt-6 flex flex-wrap gap-2">
        {providerList.map((provider) => (
          <span
            key={provider.protocol}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border border-zinc-200/80 bg-zinc-50/60 px-2.5 py-1.5 font-mono text-[11px] text-zinc-600 dark:border-white/8 dark:bg-white/3 dark:text-zinc-400",
            )}
          >
            <span className="bg-brand-500 h-1.5 w-1.5 rounded-full" />
            {provider.protocol}
          </span>
        ))}
      </div>
    );
  }

  if (kind === "safety") {
    return (
      <div className="mt-6 flex flex-wrap gap-2">
        {permissionModes.map((mode) => (
          <span key={mode.mode} className={chip}>
            <ShieldCheck className="text-brand-500 h-3 w-3" />
            {mode.mode}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-wrap gap-2">
      {agentCards.map((agent) => (
        <span
          key={agent.name}
          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200/80 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 dark:border-white/8 dark:bg-white/3 dark:text-zinc-300"
        >
          <agent.icon className="text-brand-500 h-3 w-3" />
          {agent.name}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200/80 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 dark:border-white/8 dark:bg-white/3 dark:text-zinc-300">
        <Bot className="text-accent-500 h-3 w-3" />
        teammates
      </span>
    </div>
  );
}

export function Features() {
  return (
    <Section id="features">
      <SectionHeader
        eyebrow="Capabilities"
        title={
          <>
            Everything a serious agent needs,
            <br className="hidden sm:block" /> none of the bloat
          </>
        }
        description="Swifty is built as a harness: a tight loop, a real toolbelt, and guardrails that you decide how tight to pull."
      />

      <div
        className={cn(
          container,
          "mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3",
        )}
      >
        {features.map((feature, index) => (
          <Reveal
            key={feature.title}
            delay={(index % 3) * 0.06}
            className={cn(feature.span === "wide" && "lg:col-span-2")}
          >
            <SpotlightCard className="h-full p-6 sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <span
                  className={cn(
                    "grid h-11 w-11 place-items-center rounded-xl",
                    ACCENT_TILE[feature.accent ?? "brand"],
                  )}
                >
                  <feature.icon className="h-5 w-5" />
                </span>
                <Sparkle className="h-4 w-4 text-zinc-300 opacity-0 transition-opacity duration-300 group-hover:opacity-100 dark:text-zinc-600" />
              </div>
              <h3
                className={cn(
                  "mt-5 text-lg font-semibold tracking-[-0.02em]",
                  heading,
                )}
              >
                {feature.title}
              </h3>
              <p className={cn("mt-2.5 text-sm leading-relaxed", muted)}>
                {feature.description}
              </p>
              {feature.decor ? <Decor kind={feature.decor} /> : null}
            </SpotlightCard>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.1} className={cn(container, "mt-4")}>
        <div
          className={cn(
            "flex flex-col items-start justify-between gap-4 rounded-2xl border bg-zinc-50/70 px-6 py-5 sm:flex-row sm:items-center dark:bg-white/2",
            line,
          )}
        >
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-950">
              <Sparkle className="h-4 w-4" />
            </span>
            <p className={cn("text-sm", muted)}>
              Built with TypeScript, React + Ink and a WASM glob engine — MIT
              licensed.
            </p>
          </div>
          <a
            href="#tools"
            className="text-brand-600 hover:text-brand-500 dark:text-brand-300 dark:hover:text-brand-200 text-sm font-semibold transition-colors"
          >
            Explore the toolbelt →
          </a>
        </div>
      </Reveal>
    </Section>
  );
}
