import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Explicit unmount between tests: without this, rendered components
// leak across test files and role-visibility assertions see stale DOM.
afterEach(() => {
  cleanup();
});
