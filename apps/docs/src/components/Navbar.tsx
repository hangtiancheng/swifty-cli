import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Menu, Moon, Sun, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { navLinks } from "@/lib/content";
import {
  container,
  focusRing,
  ghostButton,
  glass,
  heading,
  line,
  muted,
  primaryButton,
} from "@/lib/styles";
import { GithubIcon } from "./ui/github-icon";
import { Logo } from "./ui/logo";
import { useTheme } from "@/hooks/use-theme";

export function Navbar({ repoUrl }: { repoUrl: string }) {
  const { theme, toggle } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b transition-all duration-300",
        scrolled
          ? cn(line, glass, "shadow-[0_1px_20px_-12px_rgba(9,9,20,0.35)]")
          : "border-transparent",
      )}
    >
      <nav
        className={cn(
          container,
          "flex h-16 items-center justify-between gap-4",
        )}
      >
        <a
          href="#top"
          className={cn("rounded-xl", focusRing)}
          aria-label="Swifty home"
        >
          <Logo />
        </a>

        <div className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={cn(
                "rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                muted,
                "hover:bg-zinc-100 hover:text-zinc-950 dark:hover:bg-white/[0.06] dark:hover:text-white",
                focusRing,
              )}
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggle}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            className={cn(ghostButton, "h-9 w-9 px-0", focusRing)}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={theme}
                initial={{ opacity: 0, rotate: -90, scale: 0.6 }}
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                exit={{ opacity: 0, rotate: 90, scale: 0.6 }}
                transition={{ duration: 0.2 }}
                className="grid place-items-center"
              >
                {theme === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </motion.span>
            </AnimatePresence>
          </button>

          <a
            href={repoUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Swifty on GitHub"
            className={cn(ghostButton, "h-9 w-9 px-0", focusRing)}
          >
            <GithubIcon className="h-[18px] w-[18px]" />
          </a>

          <a
            href="#install"
            className={cn(
              primaryButton,
              "hidden h-9 px-4 sm:inline-flex",
              focusRing,
            )}
          >
            Get started
            <ArrowRight className="h-4 w-4" />
          </a>

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-label="Toggle menu"
            aria-expanded={open}
            className={cn(ghostButton, "h-9 w-9 px-0 md:hidden", focusRing)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className={cn("overflow-hidden border-t md:hidden", line, glass)}
          >
            <div className={cn(container, "flex flex-col gap-1 py-4")}>
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "rounded-xl px-3 py-2.5 text-base font-medium",
                    heading,
                    "hover:bg-zinc-100 dark:hover:bg-white/[0.06]",
                  )}
                >
                  {link.label}
                </a>
              ))}
              <a
                href="#install"
                onClick={() => setOpen(false)}
                className={cn(primaryButton, "mt-2 w-full")}
              >
                Get started
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
