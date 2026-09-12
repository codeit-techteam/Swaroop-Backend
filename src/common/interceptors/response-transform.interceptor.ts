import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { successResponse } from '../utils/response.util.js';

/**
 * Optional response shaping interceptor.
 * Controllers may also return ApiSuccessResponse manually via successResponse().
 * Does not wrap responses that already follow the success convention.
 */
@Injectable()
export class ResponseTransformInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      map((data: unknown) => {
        if (
          data &&
          typeof data === 'object' &&
          'success' in data &&
          (data as { success: unknown }).success === true
        ) {
          return data;
        }

        return successResponse(data);
      }),
    );
  }
}
