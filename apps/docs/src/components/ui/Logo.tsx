import { cn } from '../../lib/cn'
import { heading } from '../../lib/styles'

export function LogoMark({ className }: { className?: string }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}favicon.svg`}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn('h-8 w-8 select-none rounded-[11px] shadow-glow', className)}
    />
  )
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className={cn('text-[17px] font-bold tracking-[-0.03em]', heading)}>Swifty</span>
    </span>
  )
}
