import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginTailwindcss } from "@rsbuild/plugin-tailwindcss";

// Docs: https://rsbuild.rs/config/
export default defineConfig({
  plugins: [
    pluginReact({
      reactCompiler: true,
    }),
    pluginTailwindcss(),
  ],
  output: {
    // Inline all assets so the built index.html can be embedded as a single
    // string constant in the Go server (see swifty_cli/internal/remote/web.go).
    inlineScripts: true,
    inlineStyles: true,
    // Assets emitted alongside the HTML are not used since everything is inlined.
    assetPrefix: "/",
  },
  html: {
    title: "Swifty Remote",
    template: "./index.html",
  },
  server: {
    // Proxy WebSocket to the Go backend during development.
    proxy: {
      "/ws": {
        target: "ws://localhost:7777",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
