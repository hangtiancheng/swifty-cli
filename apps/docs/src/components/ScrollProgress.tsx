import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useScroll, useSpring } from 'motion/react'
import { ArrowUp } from 'lucide-react'
import { cn } from '../lib/cn'
import { focusRing } from '../lib/styles'

export function ScrollProgress() {
  const { scrollYProgress } = useScroll()
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 24, mass: 0.3 })
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 800)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <>
      <motion.div
        style={{ scaleX }}
        className="fixed inset-x-0 top-0 z-[60] h-0.5 origin-left bg-linear-to-r from-brand-500 via-brand-600 to-accent-500"
        aria-hidden="true"
      />
      <AnimatePresence>
        {visible ? (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.9 }}
            transition={{ duration: 0.22 }}
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            aria-label="Back to top"
            className={cn(
              'fixed bottom-6 right-6 z-50 grid h-11 w-11 place-items-center rounded-full border border-zinc-200/80 bg-white/85 text-zinc-700 shadow-soft backdrop-blur transition-colors hover:text-brand-600 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-200 dark:hover:text-brand-300',
              focusRing,
            )}
          >
            <ArrowUp className="h-4 w-4" />
          </motion.button>
        ) : null}
      </AnimatePresence>
    </>
  )
}
