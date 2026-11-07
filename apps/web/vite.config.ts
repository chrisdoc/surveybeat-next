import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Two entries in one project: the app (React) and the answer page (static, no React).
export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    rollupOptions: {
      // Base UI ships "use client" directives, which mean nothing in a client-only build.
      onwarn(warning, defaultHandler) {
        if (warning.code !== "MODULE_LEVEL_DIRECTIVE") defaultHandler(warning);
      },
      input: {
        app: "index.html",
        answer: "answer.html",
      },
    },
  },
});
