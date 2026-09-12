/**
 * Shared Tailwind utility recipes.
 *
 * Everything here is a plain string of Tailwind utilities — there are no custom
 * CSS classes or selectors. Keeping the long class lists in one place keeps the
 * components readable without introducing a parallel stylesheet.
 */

export const page =
  "min-h-screen bg-white font-sans text-zinc-600 antialiased selection:bg-brand-500/30 dark:bg-[#08080c] dark:text-zinc-400 dark:selection:bg-brand-400/30";

export const heading = "text-zinc-950 dark:text-zinc-50";
export const muted = "text-zinc-500 dark:text-zinc-500";
export const faint = "text-zinc-400 dark:text-zinc-600";

export const line = "border-zinc-200/80 dark:border-white/[0.08]";

export const container = "mx-auto w-full max-w-6xl px-5 sm:px-8";

export const card =
  "rounded-2xl border border-zinc-200/80 bg-white shadow-card dark:border-white/[0.08] dark:bg-white/[0.025] dark:shadow-none";

export const cardHover =
  "transition-all duration-300 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-soft dark:hover:border-white/20 dark:hover:bg-white/[0.05]";

export const glass = "bg-white/75 backdrop-blur-xl dark:bg-[#08080c]/75";

export const gradientText =
  "bg-linear-to-r from-brand-600 via-brand-700 to-accent-600 bg-clip-text text-transparent dark:from-brand-300 dark:via-brand-400 dark:to-accent-300";

export const brandGradient =
  "bg-linear-to-br from-brand-400 via-brand-500 to-accent-500";

export const gridPattern =
  "bg-[linear-gradient(to_right,rgba(9,9,20,0.055)_1px,transparent_1px),linear-gradient(to_bottom,rgba(9,9,20,0.055)_1px,transparent_1px)] bg-[size:56px_56px] dark:bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)]";

export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#08080c]";

export const eyebrow =
  "inline-flex items-center gap-2 rounded-full border border-zinc-200/80 bg-white/70 px-3 py-1 text-xs font-medium tracking-wide text-zinc-600 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-zinc-400";

export const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_-12px_rgba(9,9,20,0.6)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-zinc-800 active:translate-y-0 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200";

export const secondaryButton =
  "inline-flex items-center justify-center gap-2 rounded-full border border-zinc-200/90 bg-white/70 px-5 py-2.5 text-sm font-semibold text-zinc-800 backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:border-zinc-300 hover:bg-white dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-200 dark:hover:border-white/20 dark:hover:bg-white/[0.07]";

export const ghostButton =
  "inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-white";

export const chip =
  "inline-flex items-center gap-1.5 rounded-lg border border-zinc-200/80 bg-white px-2.5 py-1.5 font-mono text-xs text-zinc-700 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-zinc-300";
