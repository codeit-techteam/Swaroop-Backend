import type { ApiSuccessResponse } from '../types/api-response.type.js';

export function successResponse<T, M = undefined>(
  data: T,
  message = 'OK',
  meta?: M,
): ApiSuccessResponse<T, M> {
  const response: ApiSuccessResponse<T, M> = {
    success: true,
    message,
    data,
  };

  if (meta !== undefined) {
    response.meta = meta;
  }

  return response;
}
