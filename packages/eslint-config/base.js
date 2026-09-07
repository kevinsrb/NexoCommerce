const typescriptEslint = require('typescript-eslint');

module.exports = typescriptEslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [typescriptEslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
);
