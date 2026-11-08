import { defineConfig } from "vitest/config"
import path from "node:path"
export default defineConfig({
  test: { environment: "node", include: ["evals/background-models/capture.eval.ts"] },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../..") } },
})
