import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiErrorResponse } from '../types/api-response.type.js';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    let message: string | string[] = 'Internal server error';
    let error = HttpStatus[statusCode] ?? 'Error';
    let details: unknown;
    let code: string | undefined;

    if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (exceptionResponse && typeof exceptionResponse === 'object') {
      const payload = exceptionResponse as Record<string, unknown>;
      if (payload.message !== undefined) {
        message = payload.message as string | string[];
      }
      if (typeof payload.error === 'string') {
        error = payload.error;
      }
      if (typeof payload.code === 'string') {
        code = payload.code;
      }
      if (payload.details !== undefined) {
        details = payload.details;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const body: ApiErrorResponse = {
      success: false,
      statusCode,
      message,
      error,
      ...(code ? { code } : {}),
      timestamp: new Date().toISOString(),
      path: request.url,
      ...(details !== undefined ? { details } : {}),
    };

    if (statusCode >= 500) {
      this.logger.error(
        {
          path: request.url,
          method: request.method,
          statusCode,
          message,
        },
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn({
        path: request.url,
        method: request.method,
        statusCode,
        message,
      });
    }

    response.status(statusCode).json(body);
  }
}
