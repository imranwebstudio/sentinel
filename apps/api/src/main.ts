import "reflect-metadata";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import helmet from "@fastify/helmet";
import cookie from "@fastify/cookie";
import { RequestMethod, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter.js";
import type { Environment } from "./config/environment.js";

const here = dirname(fileURLToPath(import.meta.url));
for (const envPath of [resolve(here, "../../../.env"), resolve(here, "../../.env"), resolve(here, "../.env")]) {
  if (existsSync(envPath)) loadEnv({ path: envPath, override: false });
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({
    logger: true,
    bodyLimit: 1_048_576,
    trustProxy: true,
  }));
  const config = app.get(ConfigService<Environment, true>);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  app.enableCors({ origin: config.get("WEB_ORIGIN", { infer: true }), credentials: true });
  app.setGlobalPrefix("api/v1", {
    exclude: [{ path: "/", method: RequestMethod.GET }],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  const openApi = new DocumentBuilder()
    .setTitle("GitHub Malware Remover API")
    .setDescription("Control plane for durable repository scans and remediation workflows.")
    .setVersion(config.get("API_VERSION", { infer: true }))
    .build();
  SwaggerModule.setup("api/docs", app, SwaggerModule.createDocument(app, openApi));

  await app.listen(
    config.get("API_PORT", { infer: true }),
    config.get("API_HOST", { infer: true }),
  );
}

void bootstrap();
