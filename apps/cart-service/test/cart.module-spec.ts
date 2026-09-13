const mockCreateClient = jest.fn();

jest.mock('redis', () => ({ createClient: mockCreateClient }));

import { createCartRedisClient } from '../src/cart/cart.module';

describe('Cart Redis client', () => {
  it('registers a safe error listener before returning the client', () => {
    const listeners: Record<string, (error: Error) => void> = {};
    const client = { on: jest.fn() };
    client.on.mockImplementation((event: string, listener: (error: Error) => void): typeof client => {
        listeners[event] = listener;
        return client;
      });
    mockCreateClient.mockReturnValue(client);

    expect(createCartRedisClient('redis://localhost:6379')).toBe(client);
    expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(() => listeners.error(new Error('redis://private-host:6379'))).not.toThrow();
  });
});
