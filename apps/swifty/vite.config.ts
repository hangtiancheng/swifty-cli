import { defineConfig, type UserConfigFn } from "vite";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";

const PKG_DIR = import.meta.dirname;

// === Mode router ===

export default defineConfig((({ mode, command }) => {
  const isDev = mode === "development" || command === "serve";
  return {
    /**
     * 'serve': during dev (`vite` command)
     * 'build': when building for production (`vite build` command)
     */
    base: isDev ? "/" : "/swifty-cli/",
    root: resolve(PKG_DIR, "app"),
    plugins: [tailwindcss()],
    build: {
      outDir: resolve(PKG_DIR, "dist"),
      emptyOutDir: true,
    },
    server: {
      port: 3300,
      open: true,
    },
  };
}) satisfies UserConfigFn);
