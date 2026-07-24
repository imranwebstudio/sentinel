import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger } from "@nestjs/common";
import type { ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<FastifyReply>();
    const request = context.getRequest<FastifyRequest>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const detail = exception instanceof HttpException ? exception.message : "An unexpected error occurred";

    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    }

    void response.status(status).send({
      type: `https://httpstatuses.com/${status}`,
      title: status >= 500 ? "Internal Server Error" : "Request failed",
      status,
      detail,
      instance: request.url,
      correlationId: request.id,
      timestamp: new Date().toISOString(),
    });
  }
}
