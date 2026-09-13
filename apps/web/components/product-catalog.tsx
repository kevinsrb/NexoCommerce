'use client';

import { useEffect, useState } from 'react';

import { loadCatalogProducts, type StorefrontProduct } from '../lib/catalog';
import { ProductStates, type ProductState } from './product-states';

export function ProductCatalog() {
  const [state, setState] = useState<ProductState>('loading');
  const [products, setProducts] = useState<StorefrontProduct[]>([]);

  useEffect(() => {
    let active = true;

    void loadCatalogProducts()
      .then((loadedProducts) => {
        if (!active) return;
        setProducts(loadedProducts);
        setState(loadedProducts.length === 0 ? 'empty' : 'ready');
      })
      .catch(() => {
        if (active) setState('error');
      });

    return () => {
      active = false;
    };
  }, []);

  return <ProductStates state={state} products={products} />;
}
