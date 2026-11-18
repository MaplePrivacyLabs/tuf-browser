import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.browser.test.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: (process.env.BROWSERS ?? "chromium").split(",").map(browser => ({
        browser: browser as "chromium" | "firefox" | "webkit",
      })),
    },
  },
});
