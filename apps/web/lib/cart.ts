import { publicGatewayUrl } from './catalog';

export type CartItem = {
  variantId: string;
  available: boolean;
  productId?: string;
  productName?: string;
  variantName?: string;
  price?: string;
  currency?: string;
  stock?: number;
  productActive?: boolean;
  variantActive?: boolean;
  quantity: number;
  subtotal: string;
};

export type Cart = { currency: string | null; items: CartItem[]; total: string; itemCount: number };

export class CartClientError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(statusCode === 401 ? 'Sign in to your account, then retry your cart.' : message);
    this.name = 'CartClientError';
  }
}

async function requestCart<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = localStorage.getItem('nexo.access-token');
  if (!token) throw new CartClientError(401, 'UNAUTHORIZED', 'Sign in required');
  const response = await fetch(`${publicGatewayUrl()}/cart${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new CartClientError(response.status, error.code, error.message, error.requestId);
  }
  return response.status === 204 ? undefined as T : response.json();
}

export const loadCart = (): Promise<Cart> => requestCart('');
export const addCartItem = (variantId: string): Promise<Cart> =>
  requestCart('/items', 'POST', { variantId, quantity: 1 });
export const updateCartItem = (variantId: string, quantity: number): Promise<Cart> =>
  requestCart(`/items/${encodeURIComponent(variantId)}`, 'PATCH', { quantity });
export const removeCartItem = (variantId: string): Promise<void> =>
  requestCart(`/items/${encodeURIComponent(variantId)}`, 'DELETE');
export const clearCart = (): Promise<void> => requestCart('', 'DELETE');
