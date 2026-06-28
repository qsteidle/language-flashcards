import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        // Browser
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        indexedDB: 'readonly',
        IDBKeyRange: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        Audio: 'readonly',
        URL: 'readonly',
        matchMedia: 'readonly',
        crypto: 'readonly',
        fetch: 'readonly',
        caches: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        MediaRecorder: 'readonly',
        AudioContext: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        console: 'readonly',
        // Service worker
        self: 'readonly',
        // Node (scripts/)
        process: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    ignores: ['node_modules/**', 'test-results/**', 'playwright-report/**'],
  },
];
