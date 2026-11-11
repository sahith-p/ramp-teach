import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/samples\//, replacement: path.resolve(__dirname, "samples") + "/" },
      { find: /^@\//, replacement: path.resolve(__dirname, "src") + "/" },
    ],
  },
  test: {
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".claude/**", ".next/**", "extension/dist/**"],
    environment: "node",
  },
});
