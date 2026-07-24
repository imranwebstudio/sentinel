import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnvironment } from "./config/environment.js";
import { HealthModule } from "./modules/health/health.module.js";
import { HomeModule } from "./modules/home/home.module.js";
import { GitHubModule } from "./modules/github/github.module.js";
import { PrismaModule } from "./modules/prisma/prisma.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ["../../.env", ".env"],
      validate: validateEnvironment,
    }),
    PrismaModule,
    HomeModule,
    HealthModule,
    GitHubModule,
  ],
})
export class AppModule {}
