export type StorefrontProduct = {
  id: string;
  variantId: string | null;
  name: string;
  description: string;
  price: string;
  category: string;
  accent: string;
};

type CatalogProduct = {
  id: string;
  name: string;
  description: string;
  slug: string;
  category: { name: string };
  variants: Array<{ id: string; active: boolean; price: string; currency: string }>;
};

const accents = [
  'from-amber-200/70 to-orange-500/20',
  'from-sky-200/70 to-blue-500/20',
  'from-emerald-200/70 to-teal-500/20',
] as const;

export const publicGatewayUrl = (): string => {
  const value = process.env.NEXT_PUBLIC_API_GATEWAY_URL;
  if (!value) throw new Error('NEXT_PUBLIC_API_GATEWAY_URL is required');
  return value.replace(/\/$/, '');
};

const formatPrice = (price: string, currency: string): string => {
  const [whole, fraction = ''] = price.split('.');
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .formatToParts(BigInt(whole))
    .map((part) => part.type === 'fraction' ? { ...part, value: fraction.padEnd(2, '0') } : part)
    .map((part) => part.value)
    .join('');
};

const toStorefrontProduct = (product: CatalogProduct, index: number): StorefrontProduct => {
  const variant = product.variants.find((candidate) => candidate.active);
  return {
    id: product.id,
    variantId: variant?.id ?? null,
    name: product.name,
    description: product.description,
    price: variant === undefined ? 'Price unavailable' : formatPrice(variant.price, variant.currency),
    category: product.category.name,
    accent: accents[index % accents.length],
  };
};

export const loadCatalogProducts = async (): Promise<StorefrontProduct[]> => {
  const response = await fetch(`${publicGatewayUrl()}/products`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Gateway catalog request failed');

  const products = (await response.json()) as CatalogProduct[];
  return products.map(toStorefrontProduct);
};
