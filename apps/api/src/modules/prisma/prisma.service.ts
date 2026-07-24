import { Inject, Injectable, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Environment } from "../../config/environment.js";
import { PrismaClient } from "../../generated/prisma/client.js";

@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly client: PrismaClient | null;

  constructor(@Inject(ConfigService) config: ConfigService<Environment, true>) {
    const connectionString = config.get("DATABASE_URL", { infer: true });
    this.client = connectionString
      ? new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
      : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  get db(): PrismaClient {
    if (!this.client) throw new ServiceUnavailableException("Database is not configured. Set DATABASE_URL and start Postgres.");
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.$disconnect();
  }
}
