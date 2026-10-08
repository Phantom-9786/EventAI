// ═══════════════════════════════════════════════════
// @eventai/config — Shared base ESLint config
// ═══════════════════════════════════════════════════
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: ['dist', 'node_modules', '.next', '.turbo', 'coverage'],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
  },
};
