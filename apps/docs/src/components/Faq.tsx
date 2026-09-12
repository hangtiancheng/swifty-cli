import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Minus, Plus } from 'lucide-react'
import { cn } from '../lib/cn'
import { faqs } from '../lib/content'
import { container, focusRing, gradientText, heading, line, muted } from '../lib/styles'
import { Reveal } from './ui/Reveal'
import { Section } from './ui/Section'

export function Faq() {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <Section id="faq">
      <div className={cn(container, 'grid grid-cols-1 gap-12 lg:grid-cols-[0.85fr_1.15fr]')}>
        <div className="lg:sticky lg:top-28 lg:self-start">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-zinc-200/80 bg-white/70 px-3 py-1 text-xs font-medium tracking-wide text-zinc-600 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-zinc-400">
              FAQ
            </span>
            <h2
              className={cn(
                'mt-5 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl',
                heading,
              )}
            >
              Questions,
              <br />
              <span className={gradientText}>answered</span>
            </h2>
            <p className={cn('mt-5 text-sm leading-relaxed sm:text-base', muted)}>
              Still curious? The full documentation lives in the repository and the CLI answers{' '}
              <code className="font-mono text-xs text-zinc-600 dark:text-zinc-300">/help</code> any
              time.
            </p>
          </Reveal>
        </div>

        <div className="space-y-3">
          {faqs.map((faq, index) => {
            const isOpen = open === index
            return (
              <Reveal key={faq.question} delay={index * 0.05}>
                <div
                  className={cn(
                    'overflow-hidden rounded-2xl border transition-colors',
                    isOpen
                      ? 'border-brand-500/30 bg-brand-500/[0.04]'
                      : cn('bg-white dark:bg-white/[0.02]', line),
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : index)}
                    aria-expanded={isOpen}
                    className={cn(
                      'flex w-full items-center justify-between gap-4 px-5 py-4 text-left',
                      focusRing,
                    )}
                  >
                    <span className={cn('text-[15px] font-semibold', heading)}>{faq.question}</span>
                    <span
                      className={cn(
                        'grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors',
                        isOpen
                          ? 'bg-brand-500 text-white'
                          : 'bg-zinc-100 text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-400',
                      )}
                    >
                      {isOpen ? <Minus className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen ? (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <p className={cn('px-5 pb-5 text-sm leading-relaxed', muted)}>
                          {faq.answer}
                        </p>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              </Reveal>
            )
          })}
        </div>
      </div>
    </Section>
  )
}
