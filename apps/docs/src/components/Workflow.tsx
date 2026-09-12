import { cn } from '../lib/cn'
import { workflowSteps } from '../lib/content'
import { container, gradientText, heading, line, muted } from '../lib/styles'
import { Reveal } from './ui/Reveal'
import { Section, SectionHeader } from './ui/Section'

export function Workflow() {
  return (
    <Section id="workflow">
      <SectionHeader
        eyebrow="Workflow"
        title={
          <>
            From prompt to <span className={gradientText}>ship</span>
          </>
        }
        description="No new mental model to learn. Describe the task, review what matters, and keep a rewind button for everything else."
      />

      <div className={cn(container, 'mt-16')}>
        <div className="relative grid grid-cols-1 gap-y-10 sm:grid-cols-2 sm:gap-x-8 lg:grid-cols-4">
          <div
            className="pointer-events-none absolute inset-x-0 top-6 hidden h-px bg-linear-to-r from-transparent via-brand-500/40 to-transparent lg:block"
            aria-hidden="true"
          />
          {workflowSteps.map((step, index) => (
            <Reveal key={step.step} delay={index * 0.08} className="relative">
              <div className="flex flex-col">
                <div className="flex items-center gap-3">
                  <span className="relative grid h-12 w-12 place-items-center rounded-2xl border bg-white shadow-soft dark:bg-[#0d0d13] dark:shadow-none border-zinc-200/80 dark:border-white/[0.08]">
                    <step.icon className="h-5 w-5 text-brand-500 dark:text-brand-400" />
                    <span className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-zinc-950 font-mono text-[10px] font-semibold text-white dark:bg-white dark:text-zinc-950">
                      {step.step}
                    </span>
                  </span>
                </div>
                <h3 className={cn('mt-5 text-base font-semibold tracking-[-0.02em]', heading)}>
                  {step.title}
                </h3>
                <p className={cn('mt-2 text-sm leading-relaxed', muted)}>{step.description}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.12} className="mt-14">
          <div
            className={cn(
              'grid grid-cols-1 gap-6 rounded-2xl border bg-zinc-50/70 p-6 sm:grid-cols-3 sm:p-8 dark:bg-white/[0.02]',
              line,
            )}
          >
            <div className="sm:col-span-1">
              <p className={cn('text-sm font-semibold', heading)}>Built to be interrupted</p>
              <p className={cn('mt-2 text-sm leading-relaxed', muted)}>
                Ctrl+C clears the prompt or stops a stream. Checkpoints let you rewind a turn,
                fork a session, or hand the thread to a teammate.
              </p>
            </div>
            <dl className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-3">
              {[
                { term: 'Ctrl+O', detail: 'Toggle full tool output' },
                { term: 'Shift+Tab', detail: 'Cycle permission modes' },
                { term: 'Ctrl+T', detail: 'Open the teams overlay' },
              ].map((item) => (
                <div
                  key={item.term}
                  className={cn('rounded-xl border bg-white px-4 py-3 dark:bg-white/[0.02]', line)}
                >
                  <dt className="font-mono text-xs font-semibold text-brand-600 dark:text-brand-300">
                    {item.term}
                  </dt>
                  <dd className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{item.detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Reveal>
      </div>
    </Section>
  )
}
