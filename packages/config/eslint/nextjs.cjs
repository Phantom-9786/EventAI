// ═══════════════════════════════════════════════════
// @eventai/config — Next.js ESLint config
// ═══════════════════════════════════════════════════
module.exports = {
  extends: [
    'next/core-web-vitals',
    require.resolve('./base.cjs'),
  ],
  rules: {
    'react/react-in-jsx-scope': 'off',
    '@next/next/no-img-element': 'off',
  },
};
