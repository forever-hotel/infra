export default [
  { ignores: ['node_modules/**', 'reports/**', 'coverage/**'] },
  {
    files: ['scripts/**/*.mjs', 'test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        structuredClone: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
        setTimeout: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
    },
  },
];
