import { defineConfig } from "vitest/config";
import path from "path";
import { generateTimestamp } from "./tests/lib/timestamp";
import { SaneHtmlReporter } from "./tests/reporters/sane-html-reporter";

const timestamp = process.env.TEST_TIMESTAMP ?? generateTimestamp();
const reportsDir = path.resolve(__dirname, "test-reports", timestamp);

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./src/__tests__/setup.ts"],
    reporters: [
      "default",
      new SaneHtmlReporter({
        resultsDir: path.join(reportsDir, "unit"),
      }),
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
