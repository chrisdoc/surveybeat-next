import { foldkit } from "@foldkit/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Two entries in one project: the app (Foldkit) and the answer page (plain TypeScript, no framework).
export default defineConfig({
  plugins: [tailwindcss(), foldkit()],
  build: {
    rollupOptions: {
      input: {
        app: "index.html",
        answer: "answer.html",
      },
    },
  },
});
