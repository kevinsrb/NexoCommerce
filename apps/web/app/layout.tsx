import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { CartProvider } from '../components/cart-provider';

import './globals.css';

export const metadata: Metadata = {
  title: 'Nexo Commerce',
  description: 'A calmer way to discover everyday essentials.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body><CartProvider>{children}</CartProvider></body>
    </html>
  );
}
