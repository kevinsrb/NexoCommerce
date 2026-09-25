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
