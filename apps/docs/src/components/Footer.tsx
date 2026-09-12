import { ArrowUpRight } from 'lucide-react'
import { cn } from '../lib/cn'
import { INSTALL_METHODS, footerColumns } from '../lib/content'
import { container, ghostButton, heading, line, focusRing } from '../lib/styles'
import { CopyButton } from './ui/CommandBox'
import { GithubIcon } from './ui/GithubIcon'
import { Logo } from './ui/Logo'

export function Footer({ repoUrl, npmUrl }: { repoUrl: string; npmUrl: string }) {
  const install = INSTALL_METHODS[0].command

  return (
    <footer className={cn('relative border-t', line)}>
      <div className={cn(container, 'py-14 sm:py-16')}>
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-3 lg:grid-cols-6">
          <div className="col-span-2 lg:col-span-3">
            <a href="#top" className={cn('inline-flex rounded-xl', focusRing)} aria-label="Swifty home">
              <Logo />
            </a>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
              A terminal-based AI coding agent with multi-provider models, sandboxed tools and
              multi-agent teams.
            </p>
            <div
              className={cn(
                'mt-6 flex max-w-sm items-center gap-2 rounded-xl border bg-white/70 px-3 py-2 dark:bg-white/[0.02]',
                line,
              )}
            >
              <span className="select-none font-mono text-xs text-brand-500">$</span>
              <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                {install}
              </code>
              <CopyButton value={install} className="h-7 w-7" />
            </div>
            <div className="mt-5 flex items-center gap-2">
              <a
                href={repoUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub"
                className={cn(ghostButton, 'h-9 w-9 px-0', focusRing)}
              >
                <GithubIcon className="h-[18px] w-[18px]" />
              </a>
              <a
                href={npmUrl}
                target="_blank"
                rel="noreferrer"
                aria-label="npm"
                className={cn(ghostButton, 'h-9 px-3 font-mono text-xs', focusRing)}
              >
                npm
              </a>
            </div>
          </div>

          {footerColumns.map((column) => (
            <div key={column.title}>
              <h3 className={cn('text-xs font-semibold uppercase tracking-[0.14em]', heading)}>
                {column.title}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      target={link.href.startsWith('http') ? '_blank' : undefined}
                      rel={link.href.startsWith('http') ? 'noreferrer' : undefined}
                      className="group inline-flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
                    >
                      {link.label}
                      {link.href.startsWith('http') ? (
                        <ArrowUpRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                      ) : null}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div
          className={cn(
            'mt-12 flex flex-col items-start justify-between gap-4 border-t pt-6 text-xs text-zinc-400 sm:flex-row sm:items-center dark:text-zinc-500',
            line,
          )}
        >
          <p>© {new Date().getFullYear()} Swifty. Released under the MIT License.</p>
          <p className="inline-flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Built for the terminal · v0.0.28
          </p>
        </div>
      </div>
    </footer>
  )
}
