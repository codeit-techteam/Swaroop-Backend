export type ApiSuccessResponse<T = unknown, M = unknown> = {
  success: true;
  message: string;
  data: T;
  meta?: M;
};

export type ApiErrorResponse = {
  success: false;
  statusCode: number;
  message: string | string[];
  error: string;
  code?: string;
  timestamp: string;
  path: string;
  details?: unknown;
};
