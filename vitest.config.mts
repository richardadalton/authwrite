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
      "@daltonr/authwrite-core":         fileURLToPath(new URL("packages/core/src/index.ts",         import.meta.url)),
      "@daltonr/authwrite-express":      fileURLToPath(new URL("packages/express/src/index.ts",      import.meta.url)),
      "@daltonr/authwrite-fastify":      fileURLToPath(new URL("packages/fastify/src/index.ts",      import.meta.url)),
      "@daltonr/authwrite-nextjs":       fileURLToPath(new URL("packages/nextjs/src/index.ts",       import.meta.url)),
      "@daltonr/authwrite-hono":         fileURLToPath(new URL("packages/hono/src/index.ts",         import.meta.url)),
      "@daltonr/authwrite-observer-pg":  fileURLToPath(new URL("packages/observer-pg/src/index.ts",  import.meta.url)),
      "@daltonr/authwrite-observer-redis": fileURLToPath(new URL("packages/observer-redis/src/index.ts", import.meta.url)),
      "@daltonr/authwrite-observer-otel":  fileURLToPath(new URL("packages/observer-otel/src/index.ts",  import.meta.url)),
      "@daltonr/authwrite-loader-db":    fileURLToPath(new URL("packages/loader-db/src/index.ts",    import.meta.url)),
      "@daltonr/authwrite-loader-yaml":  fileURLToPath(new URL("packages/loader-yaml/src/index.ts",  import.meta.url)),
      "@daltonr/authwrite-testing":      fileURLToPath(new URL("packages/testing/src/index.ts",      import.meta.url)),
      "@daltonr/authwrite-devtools":     fileURLToPath(new URL("packages/devtools/src/index.ts",     import.meta.url)),
      "@daltonr/authwrite-hateoas":      fileURLToPath(new URL("packages/hateoas/src/index.ts",      import.meta.url)),
      "@daltonr/authwrite-rulewrite":    fileURLToPath(new URL("packages/rulewrite/src/index.ts",    import.meta.url)),
    },
  },
});
