import { defineConfig } from "vitest/config";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
