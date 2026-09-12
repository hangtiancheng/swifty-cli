import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Check, Download, Star } from 'lucide-react'
import { cn } from '../lib/cn'
import { DOCS_URL, INSTALL_METHODS, QUICK_COMMANDS, REPO_URL, VERSION } from '../lib/content'
import {
  container,
  focusRing,
  gradientText,
  gridPattern,
  heading,
  line,
  primaryButton,
  secondaryButton,
} from '../lib/styles'
import { CopyButton } from './ui/CommandBox'
import { GithubIcon } from './ui/GithubIcon'
import { Reveal } from './ui/Reveal'
import { Section, SectionHeader } from './ui/Section'

export function Install() {
  const [active, setActive] = useState<(typeof INSTALL_METHODS)[number]['id']>('curl')
  const method = INSTALL_METHODS.find((item) => item.id === active) ?? INSTALL_METHODS[0]

  return (
    <Section id="install" className="overflow-hidden">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className={cn('absolute inset-0', gridPattern, 'opacity-60')} />
        <div className="absolute left-1/2 top-10 h-[26rem] w-[52rem] -translate-x-1/2 rounded-full bg-brand-500/15 blur-[130px] dark:bg-brand-600/20" />
      </div>

      <SectionHeader
        eyebrow="Install"
        title={
          <>
            Up and running in <span className={gradientText}>one command</span>
          </>
        }
        description="Requires Node.js 20 or newer. The installer picks the latest release; npm and pnpm work just as well."
      />

      <Reveal delay={0.08} className={cn(container, 'relative mt-12')}>
        <div className={cn('mx-auto max-w-3xl rounded-3xl p-6 sm:p-8', 'border bg-white/80 shadow-card backdrop-blur-xl dark:bg-white/[0.03] dark:shadow-none', line)}>
          <div className="flex flex-wrap gap-2">
            {INSTALL_METHODS.map((item) => {
              const selected = item.id === active
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActive(item.id)}
                  className={cn(
                    'relative rounded-full px-4 py-2 text-sm font-medium transition-colors',
                    focusRing,
                    selected
                      ? 'bg-zinc-950 text-white dark:bg-white dark:text-zinc-950'
                      : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-white',
                  )}
                >
                  {item.label}
                </button>
              )
            })}
            <span className="ml-auto hidden self-center text-xs text-zinc-400 sm:block dark:text-zinc-500">
              {method.hint}
            </span>
          </div>

          <div className="mt-5">
            <AnimatePresence mode="wait">
              <motion.div
                key={method.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25 }}
                className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-zinc-950"
              >
                <span className="hidden select-none font-mono text-sm text-brand-600 sm:block dark:text-brand-400">
                  $
                </span>
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[13px] text-zinc-700 dark:text-zinc-100">
                  {method.command}
                </code>
                <CopyButton
                  value={method.command}
                  className="text-zinc-400 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white"
                />
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {QUICK_COMMANDS.map((item) => (
              <div
                key={item.command}
                className={cn('rounded-xl border bg-white/70 px-4 py-3 dark:bg-white/[0.02]', line)}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      item.tone === 'brand' && 'bg-brand-500',
                      item.tone === 'accent' && 'bg-accent-400',
                      item.tone === 'neutral' && 'bg-zinc-400 dark:bg-zinc-600',
                    )}
                  />
                  <span className={cn('text-xs font-semibold', heading)}>{item.label}</span>
                </div>
                <code className="mt-2 block truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                  {item.command}
                </code>
              </div>
            ))}
          </div>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href={`${REPO_URL}#installation`}
              target="_blank"
              rel="noreferrer"
              className={cn(primaryButton, 'w-full sm:w-auto', focusRing)}
            >
              <Download className="h-4 w-4" />
              Install Swifty
            </a>
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className={cn(secondaryButton, 'w-full sm:w-auto', focusRing)}
            >
              Read the docs
              <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className={cn(secondaryButton, 'w-full sm:w-auto', focusRing)}
            >
              <GithubIcon className="h-4 w-4" />
              GitHub
              <Star className="h-3.5 w-3.5 text-amber-400" />
            </a>
          </div>

          <ul className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-zinc-400 dark:text-zinc-500">
            <li className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-emerald-500" />
              Node.js 20+
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-emerald-500" />
              macOS, Linux &amp; Windows
            </li>
            <li className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-emerald-500" />
              MIT licensed · {VERSION}
            </li>
          </ul>
        </div>
      </Reveal>

      <Reveal delay={0.12} className={cn(container, 'relative mt-16')}>
        <div className="relative overflow-hidden rounded-3xl border border-brand-500/15 bg-brand-50 px-6 py-12 text-center sm:px-12 sm:py-16 dark:border-transparent dark:bg-white/[0.04]">
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div className="absolute -top-24 left-1/2 h-72 w-[40rem] -translate-x-1/2 rounded-full bg-brand-500/20 blur-[110px] dark:bg-brand-500/25" />
            <div className="absolute -bottom-24 right-0 h-64 w-64 rounded-full bg-accent-500/15 blur-[110px] dark:bg-accent-500/20" />
          </div>
          <div className="relative">
            <h2 className={cn('text-3xl font-semibold tracking-[-0.03em] sm:text-4xl', heading)}>
              Give Swifty a real task
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm text-zinc-600 sm:text-base dark:text-zinc-400">
              Point it at your repository, describe what you want, and watch it plan, edit and
              verify — with you in control of every write.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <a
                href="#top"
                className={cn(
                  'inline-flex w-full items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:-translate-y-0.5 hover:bg-zinc-800 sm:w-auto dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200',
                  focusRing,
                )}
              >
                Get started
                <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href={DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  'inline-flex w-full items-center justify-center gap-2 rounded-full border border-zinc-300 bg-white/70 px-5 py-2.5 text-sm font-semibold text-zinc-800 backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:bg-white sm:w-auto dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:bg-white/10',
                  focusRing,
                )}
              >
                View documentation
              </a>
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  )
}
