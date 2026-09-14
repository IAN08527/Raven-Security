import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Vitest runs the client test suite (M5-T3/T4). jsdom for component
// tests; pure logic tests run in the same environment harmlessly.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
