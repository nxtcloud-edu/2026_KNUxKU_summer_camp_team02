import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist', 'node_modules', 'public/mediapipe'] }, // WASM 글루 코드는 검사 대상이 아니다
  {
    // 빌드 스크립트는 Node에서 돈다
    files: ['scripts/**/*.js', '*.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: globals.node,
      parserOptions: { sourceType: 'module' },
    },
    rules: { ...js.configs.recommended.rules },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: { react: { version: 'detect' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,

      // JSX 변환이 자동이라 React를 import하지 않는다
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',

      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],

      /* react-hooks v6는 React Compiler 시대 규칙까지 검사한다.
         이 코드베이스에는 의도적으로 남긴 패턴(초기 동기화용 setState,
         이벤트 핸들러 안의 Date.now 등)이 있어 빌드를 막지 않고 경고로 둔다.
         새로 쓰는 코드는 경고를 남기지 않는 방향으로 작성할 것. */
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
]
