import crypto from "node:crypto";
import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Environment } from "../../config/environment.js";

const tokenCookie = "bat-remover.github-token";
const stateCookie = "bat-remover.oauth-state";

@Injectable()
export class GitHubAuthService {
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly apiPublicUrl: string;
  private readonly webOrigin: string;
  private readonly key: Buffer;

  constructor(@Inject(ConfigService) config: ConfigService<Environment, true>) {
    this.clientId = config.get("GITHUB_CLIENT_ID", { infer: true });
    this.clientSecret = config.get("GITHUB_CLIENT_SECRET", { infer: true });
    this.apiPublicUrl = config.get("API_PUBLIC_URL", { infer: true });
    this.webOrigin = config.get("WEB_ORIGIN", { infer: true });
    const secret = config.get("SESSION_SECRET", { infer: true }) ?? "development-only-change-this-secret-now";
    this.key = crypto.createHash("sha256").update(secret).digest();
  }

  start(reply: FastifyReply): void {
    this.requireConfig();
    const state = crypto.randomBytes(24).toString("base64url");
    reply.setCookie(stateCookie, state, this.cookieOptions(600));
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", this.clientId!);
    url.searchParams.set("redirect_uri", this.callbackUrl());
    url.searchParams.set("scope", "repo read:org");
    url.searchParams.set("state", state);
    reply.code(302).redirect(url.toString());
  }

  async callback(request: FastifyRequest, reply: FastifyReply, code: string, state: string): Promise<void> {
    this.requireConfig();
    if (!code || !state || request.cookies[stateCookie] !== state) throw new ServiceUnavailableException("Invalid or expired GitHub OAuth state. Please try connecting again.");
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: this.clientId, client_secret: this.clientSecret, code, redirect_uri: this.callbackUrl() }),
    });
    const data = await response.json() as { access_token?: string; error_description?: string };
    if (!response.ok || !data.access_token) throw new ServiceUnavailableException(data.error_description ?? "GitHub did not return an access token.");
    reply.setCookie(tokenCookie, this.encrypt(data.access_token), this.cookieOptions(60 * 60 * 24 * 14));
    reply.clearCookie(stateCookie, { path: "/" });
    reply.code(302).redirect(`${this.webOrigin}/projects`);
  }

  token(request: FastifyRequest): string | undefined {
    const encrypted = request.cookies[tokenCookie];
    return encrypted ? this.decrypt(encrypted) : undefined;
  }

  logout(reply: FastifyReply): void {
    reply.clearCookie(tokenCookie, { path: "/" });
  }

  configured(): boolean { return Boolean(this.clientId && this.clientSecret); }
  callbackUrl(): string { return `${this.apiPublicUrl}/api/v1/github/oauth/callback`; }

  private requireConfig(): void {
    if (!this.configured()) throw new ServiceUnavailableException("GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.");
  }

  private cookieOptions(maxAge: number) {
    return { path: "/", httpOnly: true, sameSite: "lax" as const, secure: this.apiPublicUrl.startsWith("https://"), maxAge };
  }

  private encrypt(value: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((item) => item.toString("base64url")).join(".");
  }

  private decrypt(value: string): string | undefined {
    try {
      const [iv, tag, encrypted] = value.split(".").map((item) => Buffer.from(item ?? "", "base64url"));
      if (!iv || !tag || !encrypted) return undefined;
      const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    } catch { return undefined; }
  }
}
