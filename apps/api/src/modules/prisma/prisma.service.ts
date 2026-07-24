import { Inject, Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Environment } from "../../config/environment.js";
import { PrismaClient } from "../../generated/prisma/client.js";

function normalizeDatabaseUrl(raw: string): string {
  // node-postgres does not use Prisma's `schema` query param; leaving it can confuse URL parsing in some paths.
  try {
    const url = new URL(raw);
    url.searchParams.delete("schema");
    return url.toString();
  } catch {
    return raw.replace(/([?&])schema=[^&]*&?/, "$1").replace(/[?&]$/, "");
  }
}

@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly client: PrismaClient | null;

  constructor(@Inject(ConfigService) config: ConfigService<Environment, true>) {
    const raw = config.get("DATABASE_URL", { infer: true });
    if (!raw) {
      this.client = null;
      this.logger.warn("DATABASE_URL is not set; scan history persistence is disabled.");
      return;
    }

    const connectionString = normalizeDatabaseUrl(raw);
    try {
      const parsed = new URL(connectionString);
      this.logger.log(`Prisma connected via ${parsed.protocol}//${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`);
    } catch {
      this.logger.warn("DATABASE_URL could not be parsed as a URL");
    }

    this.client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
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
