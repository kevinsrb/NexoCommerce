import { ApiError } from './index';

describe('ApiError', () => {
  it('constructs a typed public API error', () => {
    const error: ApiError = {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
      requestId: 'request-123',
    };

    expect(error).toEqual({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid request',
      requestId: 'request-123',
    });
  });
});
