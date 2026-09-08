import { render, screen } from '@testing-library/react';

import Home from '../app/page';

describe('Home', () => {
  it('renders the storefront navigation, hero, products, and UI states', () => {
    render(<Home />);

    expect(screen.getByRole('navigation', { name: /primary navigation/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /commerce that feels effortless/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /featured essentials/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /loading products/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /nothing here yet/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /we couldn't load products/i })).toBeInTheDocument();
  });
});
