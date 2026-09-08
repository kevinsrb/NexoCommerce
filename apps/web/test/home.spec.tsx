import { render, screen } from '@testing-library/react';

import Home from '../app/page';
import { ProductStates } from '../components/product-states';
import { featuredProducts } from '../lib/catalog';

describe('Home', () => {
  it('renders the storefront navigation, hero, and ready products', () => {
    render(<Home />);

    expect(screen.getByRole('navigation', { name: /primary navigation/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /commerce that feels effortless/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /featured essentials/i })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: /product grid/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /loading products/i })).not.toBeInTheDocument();
  });

  it('links Experience to the rendered product-state boundary', () => {
    render(<Home />);

    expect(screen.getByRole('link', { name: /experience/i })).toHaveAttribute('href', '#states');
    expect(document.getElementById('states')).toBeInTheDocument();
  });
});

describe('ProductStates', () => {
  it('renders the product grid in ready mode', () => {
    render(<ProductStates state="ready" products={featuredProducts} />);

    expect(screen.getByRole('list', { name: /product grid/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /arc lamp/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /loading products/i })).not.toBeInTheDocument();
  });

  it.each([
    ['loading', 'Loading products'],
    ['empty', 'Nothing here yet'],
    ['error', "We couldn't load products"],
  ] as const)('renders only the %s product state without the grid', (state, stateHeading) => {
    render(<ProductStates state={state} products={featuredProducts} />);

    expect(screen.getByRole('heading', { name: stateHeading })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /product grid/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /arc lamp/i })).not.toBeInTheDocument();

    for (const otherHeading of ['Loading products', 'Nothing here yet', "We couldn't load products"]) {
      if (otherHeading !== stateHeading) {
        expect(screen.queryByRole('heading', { name: otherHeading })).not.toBeInTheDocument();
      }
    }
  });
});
