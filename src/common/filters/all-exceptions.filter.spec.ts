import { BadRequestException, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function run(exception: unknown) {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url: '/api/v1/test', method: 'GET', id: 'req-123' }),
    }),
  } as unknown as ArgumentsHost;

  new AllExceptionsFilter().catch(exception, host);
  return { status, body: json.mock.calls[0]?.[0] as Record<string, unknown> };
}

describe('AllExceptionsFilter', () => {
  it('hides internal error messages behind a generic 500', () => {
    const { status, body } = run(
      new Error(
        'Invalid `prisma.user.findMany()` invocation: connection to db.internal:25060 failed',
      ),
    );

    expect(status).toHaveBeenCalledWith(500);
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('prisma');
    expect(body.requestId).toBe('req-123');
  });

  it('keeps HTTP exception messages and codes for clients', () => {
    const { status, body } = run(
      new BadRequestException({
        message: 'phone is required',
        code: 'VALIDATION',
      }),
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(body).toMatchObject({
      success: false,
      message: 'phone is required',
      code: 'VALIDATION',
      requestId: 'req-123',
    });
  });
});
