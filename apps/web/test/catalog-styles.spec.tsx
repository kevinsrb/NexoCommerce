/** @jest-environment node */
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

import config from '../tailwind.config';

it('builds gradient colors for every featured product', async () => {
  const result = await postcss([tailwindcss(config)]).process('@tailwind utilities;', {
    from: undefined,
  });
  const selectors = new Set<string>();
  result.root.walkRules((rule) => {
    selectors.add(rule.selector);
  });

  for (const selector of [
    '.from-amber-200\\/70',
    '.to-orange-500\\/20',
    '.from-sky-200\\/70',
    '.to-blue-500\\/20',
    '.from-emerald-200\\/70',
    '.to-teal-500\\/20',
  ]) {
    expect(selectors).toContain(selector);
  }
});
