import nextPlugin from '@next/eslint-plugin-next';
import nexoConfig from '../../packages/eslint-config/base.js';

export default [
  ...nexoConfig,
  {
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: nextPlugin.configs.recommended.rules,
  },
];
