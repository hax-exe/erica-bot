import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // Allow unused vars with underscore prefix (common pattern for Discord.js)
            '@typescript-eslint/no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_'
            }],
            // Allow any for complex Discord.js types when needed
            '@typescript-eslint/no-explicit-any': 'warn',
            // Prefer strict equality
            'eqeqeq': ['error', 'always'],
            // No console in production
            'no-console': 'warn',
        },
    },
    {
        ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'dashboard/**', '*.config.js'],
    }
);
