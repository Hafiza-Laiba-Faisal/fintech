import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    reporter: "verbose",
    isolate: true,
    // Suppress live LLM calls during tests. The server reads LLM_ENDPOINT_URL
    // at module load time; clearing it here ensures every /api/plan request
    // uses the offline regex planner instead of waiting up to 20 s for a
    // network endpoint that is not running in CI or unit-test runs.
    env: {
      LLM_ENDPOINT_URL: "",
      LLM_API_KEY: "",
    },
  },
});
