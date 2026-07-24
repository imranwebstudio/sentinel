import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Controller, Get, Header, Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Environment } from "../../config/environment.js";

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(here, "../../../public/index.html");

@Controller()
export class HomeController {
  private readonly html: string;

  constructor(@Inject(ConfigService) config: ConfigService<Environment, true>) {
    const webOrigin = config.get("WEB_ORIGIN", { infer: true });
    const version = config.get("API_VERSION", { infer: true });
    this.html = readFileSync(htmlPath, "utf8")
      .replaceAll("http://localhost:5173", webOrigin)
      .replace(
        '<strong id="version">—</strong>',
        `<strong id="version">${version}</strong>`,
      );
  }

  @Get()
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "no-cache")
  home(): string {
    return this.html;
  }
}
