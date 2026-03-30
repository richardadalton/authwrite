import { fileURLToPath, URL } from "url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/**/test/**/*.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@authwrite/core":         fileURLToPath(new URL("packages/core/src/index.ts",         import.meta.url)),
      "@authwrite/express":      fileURLToPath(new URL("packages/express/src/index.ts",      import.meta.url)),
      "@authwrite/fastify":      fileURLToPath(new URL("packages/fastify/src/index.ts",      import.meta.url)),
      "@authwrite/nextjs":       fileURLToPath(new URL("packages/nextjs/src/index.ts",       import.meta.url)),
      "@authwrite/hono":         fileURLToPath(new URL("packages/hono/src/index.ts",         import.meta.url)),
      "@authwrite/observer-pg":  fileURLToPath(new URL("packages/observer-pg/src/index.ts",  import.meta.url)),
      "@authwrite/observer-redis": fileURLToPath(new URL("packages/observer-redis/src/index.ts", import.meta.url)),
      "@authwrite/observer-otel":  fileURLToPath(new URL("packages/observer-otel/src/index.ts",  import.meta.url)),
      "@authwrite/loader-db":    fileURLToPath(new URL("packages/loader-db/src/index.ts",    import.meta.url)),
      "@authwrite/loader-yaml":  fileURLToPath(new URL("packages/loader-yaml/src/index.ts",  import.meta.url)),
      "@authwrite/testing":      fileURLToPath(new URL("packages/testing/src/index.ts",      import.meta.url)),
    },
  },
});
