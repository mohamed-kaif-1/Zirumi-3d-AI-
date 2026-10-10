import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  { files: ['**/*.{js,jsx,mjs}'], languageOptions: { globals: { ...globals.browser, ...globals.node }, parserOptions: { ecmaFeatures: { jsx: true } } } },
  { files: ['src/**/*.jsx'], plugins: { react }, rules: { 'react/jsx-uses-vars': 'error', 'react/jsx-uses-react': 'error' } },
];
