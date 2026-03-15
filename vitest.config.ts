import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only run tests in src/ — exclude references/ subtrees which have their own deps
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    exclude: ["references/**", "node_modules/**", "dist/**"],
    // Allow enough time for LLM responses in integration tests
    testTimeout: 30_000,
    hookTimeout: 10_000,
    // Load .env for all tests (agent tests need GOOGLE_API_KEY)
    setupFiles: ["dotenv/config"],
    // Run in the same process so fetch can reach localhost
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
