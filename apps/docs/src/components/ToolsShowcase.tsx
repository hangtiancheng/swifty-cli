import { Command } from 'lucide-react'
import { cn } from '../lib/cn'
import { slashCommands, tools } from '../lib/content'
import type { ToolItem } from '../lib/content'
import { chip, container, heading, line, muted } from '../lib/styles'
import { Reveal } from './ui/Reveal'
import { Section, SectionHeader } from './ui/Section'

const GROUPS: Array<ToolItem['group']> = ['Files', 'Shell', 'Search', 'Orchestrate', 'Integrate']

function Marquee({ items, reverse }: { items: string[]; reverse?: boolean }) {
  const doubled = [...items, ...items]
  return (
    <div className="flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
      <div
        className={cn(
          'flex w-max shrink-0 items-center gap-3 pr-3',
          reverse ? 'animate-marquee-slow [animation-direction:reverse]' : 'animate-marquee',
        )}
      >
        {doubled.map((name, index) => (
          <span
            key={`${name}-${String(index)}`}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200/80 bg-white px-3.5 py-2 font-mono text-xs text-zinc-600 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-zinc-400"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500/70" />
            {name}
          </span>
        ))}
      </div>
    </div>
  )
}

export function ToolsShowcase() {
  const names = tools.map((tool) => tool.name)
  const half = Math.ceil(names.length / 2)

  return (
    <Section id="tools" className="bg-zinc-50/60 dark:bg-white/[0.015]">
      <SectionHeader
        eyebrow="Toolbelt"
        title={
          <>
            A real set of tools, <span className="text-brand-500">not just chat</span>
          </>
        }
        description="Read and write files, run shells, search the tree, spawn teammates and call MCP servers — each one permission-checked before it runs."
      />

      <Reveal delay={0.08} className="mt-12 space-y-3">
        <Marquee items={names.slice(0, half)} />
        <Marquee items={names.slice(half)} reverse />
      </Reveal>

      <div className={cn(container, 'mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5')}>
        {GROUPS.map((group, index) => (
          <Reveal key={group} delay={index * 0.05}>
            <div className={cn('h-full rounded-2xl border bg-white p-5 dark:bg-white/[0.02]', line)}>
              <h3 className={cn('text-sm font-semibold', heading)}>{group}</h3>
              <ul className="mt-4 space-y-2">
                {tools
                  .filter((tool) => tool.group === group)
                  .map((tool) => (
                    <li key={tool.name} className="flex items-center gap-2">
                      <tool.icon className="h-3.5 w-3.5 shrink-0 text-brand-500 dark:text-brand-400" />
                      <span className="font-mono text-xs text-zinc-600 dark:text-zinc-400">
                        {tool.name}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.1} className={cn(container, 'mt-14')}>
        <div className={cn('rounded-2xl border bg-white p-6 sm:p-8 dark:bg-white/[0.02]', line)}>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-500/12 text-brand-600 dark:bg-brand-400/12 dark:text-brand-300">
              <Command className="h-5 w-5" />
            </span>
            <div>
              <h3 className={cn('text-base font-semibold', heading)}>Slash commands</h3>
              <p className={cn('text-sm', muted)}>
                Drive the session without leaving the prompt.
              </p>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {slashCommands.map((command) => (
              <span key={command} className={cn(chip, 'text-[11px]')}>
                {command}
              </span>
            ))}
          </div>
        </div>
      </Reveal>
    </Section>
  )
}
