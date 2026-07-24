import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

function prismaDetail(exception: unknown): string | undefined {
  if (!exception || typeof exception !== "object") return undefined;
  const error = exception as { name?: string; code?: string; message?: string };
  if (error.name !== "PrismaClientKnownRequestError" && error.name !== "PrismaClientInitializationError") {
    return undefined;
  }
  if (error.code === "P1001" || error.code === "P1000" || error.code === "P1017") {
    return "Database is unreachable. Check DATABASE_URL / Postgres and retry.";
  }
  if (error.code === "P1010" || error.code === "P1002") {
    return "Database rejected the connection (auth/SSL). Check DATABASE_URL credentials.";
  }
  if (error.code === "P2021" || error.code === "P2022") {
    return "Database schema is missing tables. Run npm run db:migrate:deploy and retry.";
  }
  if (typeof error.message === "string" && /can't reach database|econnrefused|connection/i.test(error.message)) {
    return "Database is unreachable. Check DATABASE_URL / Postgres and retry.";
  }
  if (typeof error.message === "string" && error.message.trim()) {
    const firstLine = error.message.split("\n").map((line) => line.trim()).find(Boolean);
    return firstLine?.slice(0, 300);
  }
  return undefined;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<FastifyReply>();
    const request = context.getRequest<FastifyRequest>();
    const prismaMessage = prismaDetail(exception);
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : prismaMessage
        ? HttpStatus.SERVICE_UNAVAILABLE
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const detail = exception instanceof HttpException
      ? exception.message
      : prismaMessage ?? "An unexpected error occurred";

    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    }

    void response.status(status).send({
      type: `https://httpstatuses.com/${status}`,
      title: status >= 500 ? "Internal Server Error" : status === 503 ? "Service Unavailable" : "Request failed",
      status,
      detail,
      instance: request.url,
      correlationId: request.id,
      timestamp: new Date().toISOString(),
    });
  }
}
