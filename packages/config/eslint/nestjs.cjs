// ═══════════════════════════════════════════════════
// @eventai/config — NestJS ESLint config
// ═══════════════════════════════════════════════════
module.exports = {
  extends: [require.resolve('./base.cjs')],
  rules: {
    // Decorators require unused constructor params (DI)
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
  },
};
