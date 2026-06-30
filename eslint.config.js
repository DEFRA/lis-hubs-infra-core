import neostandard from 'neostandard'
import sonarjs from 'eslint-plugin-sonarjs'

export default [
  ...neostandard({
    env: ['node', 'vitest'],
    ignores: [...neostandard.resolveIgnoresFromGitignore()],
    noJsx: true,
    noStyle: true
  }),
  {
    plugins: { sonarjs },
    rules: {
      'sonarjs/no-unused-vars': 'error',
      'sonarjs/no-unused-function-argument': 'error',
      'sonarjs/elseif-without-else': 'error',
      'sonarjs/no-inconsistent-returns': 'error',
      'sonarjs/no-duplicate-string': 'error',
      'sonarjs/no-undefined-assignment': 'error',
      curly: ['error', 'all'],
      'max-lines-per-function': ['error', { max: 75 }]
    }
  },
  {
    languageOptions: {
      ecmaVersion: 2025
    }
  },
  {
    files: ['**/*.test.js', '**/*.spec.js'],
    rules: {
      'sonarjs/no-unused-vars': 'off',
      'sonarjs/no-unused-function-argument': 'off',
      'sonarjs/elseif-without-else': 'off',
      'sonarjs/no-inconsistent-returns': 'off',
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/no-undefined-assignment': 'off',
      curly: 'off',
      'max-lines-per-function': 'off'
    }
  }
]
