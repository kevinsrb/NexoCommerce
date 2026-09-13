export type StorefrontProduct = {
  name: string;
  description: string;
  price: string;
  category: string;
  accent: string;
};

type CatalogProduct = {
  name: string;
  description: string;
  slug: string;
  category: { name: string };
  variants: Array<{ price: string; currency: string }>;
};

const accents = [
  'from-amber-200/70 to-orange-500/20',
  'from-sky-200/70 to-blue-500/20',
  'from-emerald-200/70 to-teal-500/20',
] as const;

const publicGatewayUrl = (): string => {
  const value = process.env.NEXT_PUBLIC_API_GATEWAY_URL;
  if (!value) throw new Error('NEXT_PUBLIC_API_GATEWAY_URL is required');
  return value.replace(/\/$/, '');
};

const formatPrice = (price: string, currency: string): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(price));

const toStorefrontProduct = (product: CatalogProduct, index: number): StorefrontProduct => ({
  name: product.name,
  description: product.description,
  price:
    product.variants[0] === undefined
      ? 'Price unavailable'
      : formatPrice(product.variants[0].price, product.variants[0].currency),
  category: product.category.name,
  accent: accents[index % accents.length],
});

export const loadCatalogProducts = async (): Promise<StorefrontProduct[]> => {
  const response = await fetch(`${publicGatewayUrl()}/products`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Gateway catalog request failed');

  const products = (await response.json()) as CatalogProduct[];
  return products.map(toStorefrontProduct);
};
