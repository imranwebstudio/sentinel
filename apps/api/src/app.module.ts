import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateEnvironment } from "./config/environment.js";
import { HealthModule } from "./modules/health/health.module.js";
import { HomeModule } from "./modules/home/home.module.js";
import { GitHubModule } from "./modules/github/github.module.js";
import { PrismaModule } from "./modules/prisma/prisma.module.js";

const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(here, "../../../.env");
const apiEnv = resolve(here, "../.env");

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: [rootEnv, apiEnv, ".env"],
      validate: validateEnvironment,
    }),
    PrismaModule,
    HomeModule,
    HealthModule,
    GitHubModule,
  ],
})
export class AppModule {}
