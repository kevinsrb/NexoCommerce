export type StorefrontProduct = {
  name: string;
  description: string;
  price: string;
  category: string;
  accent: string;
};

// This local fixture keeps page presentation independent from the future catalog client.
export const featuredProducts: readonly StorefrontProduct[] = [
  {
    name: 'Arc Lamp',
    description: 'Soft, directed light for slower evenings.',
    price: '$128',
    category: 'Living',
    accent: 'from-amber-200/70 to-orange-500/20',
  },
  {
    name: 'Field Notes Set',
    description: 'Three cloth-bound books for ideas in motion.',
    price: '$24',
    category: 'Desk',
    accent: 'from-sky-200/70 to-blue-500/20',
  },
  {
    name: 'Moss Throw',
    description: 'A heavyweight layer woven for unhurried weekends.',
    price: '$86',
    category: 'Home',
    accent: 'from-emerald-200/70 to-teal-500/20',
  },
];
