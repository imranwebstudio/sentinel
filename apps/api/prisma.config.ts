import { existsSync } from "node:fs";
import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

for (const path of ["../../.env", ".env"]) {
  if (existsSync(path)) config({ path, quiet: true });
}

export default defineConfig({
  schema: "../../prisma/schema.prisma",
  migrations: { path: "../../prisma/migrations" },
  datasource: { url: env("DATABASE_URL") },
});
