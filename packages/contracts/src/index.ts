export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
  requestId: string;
}

export interface HealthResponse {
  status: 'ok';
  service: string;
}

export interface InternalCatalogVariant {
  id: string;
  productId: string;
  productName: string;
  variantName: string;
  price: string;
  currency: string;
  stock: number;
  productActive: boolean;
  variantActive: boolean;
}

export interface CartItemResponse {
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
}

export interface CartResponse {
  currency: string | null;
  items: CartItemResponse[];
  itemCount: number;
  total: string;
}

export type OrderState = 'PENDING' | 'EXPIRED';

export interface CheckoutPriceExpectation {
  variantId: string;
  price_decimal: string;
  currency: string;
}

export interface CheckoutLineSnapshot {
  variantId: string;
  quantity: number;
  unit_price_decimal: string;
  line_total_decimal: string;
  currency: string;
}

export interface CheckoutResponse {
  orderId: string;
  state: OrderState;
  currency: string;
  total_decimal: string;
  expiresAt: string;
  publicationRevision: number;
  lines: CheckoutLineSnapshot[];
}

export interface CheckoutRequest {
  expectedPrices: CheckoutPriceExpectation[];
}

export interface CheckoutProcessingResponse {
  code: 'CHECKOUT_PROCESSING';
  message: string;
  request_id: string;
}

export interface CartCheckoutSnapshot {
  version: number;
  lines: Array<{ variantId: string; quantity: number }>;
}

export interface CheckoutCatalogVariant extends CheckoutPriceExpectation {
  sellable: boolean;
  available: number;
}

export interface CatalogReservationLine {
  variantId: string;
  quantity: number;
  expected_price_decimal: string;
  expected_currency: string;
}

export interface CatalogReservation {
  reservationId: string;
  attemptId: string;
  state: 'ACTIVE' | 'PUBLISHED' | 'EXPIRED' | 'RELEASED';
  reservedAt: string;
  expiresAt: string;
  boundOrderId: string | null;
  publicationRevision: number | null;
  lines: Array<Omit<CheckoutLineSnapshot, 'line_total_decimal'>>;
}
