import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
    {
        ignores: [
            'dist/**',
            'target/**',
            'node_modules/**',
            'ui/src/domain/wasm/**',
            'viewer/src/wasm/**',
            'ui/src/spec/schema.generated.ts',
            'src-tauri/**',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    reactHooks.configs.flat['recommended-latest'] ?? reactHooks.configs.flat.recommended,
    {
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
            ],
            // React 19 compiler-oriented rules flag the imperative three.js bridge; keep the classics.
            'react-hooks/refs': 'off',
            'react-hooks/immutability': 'off',
            'react-hooks/set-state-in-effect': 'off',
        },
    },
    {
        files: ['**/*.mjs'],
        languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
    },
    prettier,
);
