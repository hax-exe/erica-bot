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
            // Relax unused vars to warnings (codebase has many pre-existing issues)
            '@typescript-eslint/no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_'
            }],
            // Allow any for complex Discord.js types when needed
            '@typescript-eslint/no-explicit-any': 'off',
            // Prefer strict equality
            'eqeqeq': ['warn', 'always'],
            // Allow console for Discord bot logging
            'no-console': 'off',
            // Relax empty object type for Discord.js patterns
            '@typescript-eslint/no-empty-object-type': 'off',
            // Relax declaration merging for Discord.js client extensions
            '@typescript-eslint/no-unsafe-declaration-merging': 'off',
        },
    },
    {
        ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'dashboard/**', '*.config.js'],
    }
);
