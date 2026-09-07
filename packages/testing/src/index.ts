export const createTestRequestId = (): string => 'test-request-id';

export const expectApiError = (value: unknown): void => {
  expect(value).toEqual(
    expect.objectContaining({
      statusCode: expect.any(Number),
      code: expect.any(String),
      message: expect.any(String),
      requestId: expect.any(String),
    }),
  );
};
