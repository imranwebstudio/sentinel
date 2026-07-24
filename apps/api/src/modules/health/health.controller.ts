import { Controller, Get, Inject } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { ApiHealth } from "@malware-remover/contracts";
import { ConfigService } from "@nestjs/config";
import type { Environment } from "../../config/environment.js";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService<Environment, true>,
  ) {}

  @Get("live")
  @ApiOperation({ summary: "Process liveness probe" })
  live(): ApiHealth {
    return this.response();
  }

  @Get("ready")
  @ApiOperation({ summary: "Service readiness probe" })
  ready(): ApiHealth {
    return this.response({
      postgres: this.config.get("DATABASE_URL", { infer: true }) ? "up" : "not_configured",
      redis: this.config.get("REDIS_URL", { infer: true }) ? "up" : "not_configured",
    });
  }

  private response(dependencies?: ApiHealth["dependencies"]): ApiHealth {
    return {
      status: "ok",
      service: "malware-remover-api",
      version: this.config.get("API_VERSION", { infer: true }),
      timestamp: new Date().toISOString(),
      ...(dependencies ? { dependencies } : {}),
    };
  }
}
