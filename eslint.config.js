/**
 * ESLint flat config —— 针对本项目配置
 *
 * 规则分为：
 *   - 关键 block（约束）：0 警告目标（CI --max-warnings=0 会断）
 *   - 业务规则（建议）：先 1 周 trial，再 block
 *   - Prettier 兼容性（最后处理）
 *
 * 不强制 .vue 单文件组件的复杂校验（vue/no-unused-vars 等暂时关掉，避免第一次跑死一片）
 */
import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import tsParser from '@typescript-eslint/parser'
import ts from 'typescript-eslint'
import vueConfig from '@vue/eslint-config-typescript'
import prettier from 'eslint-config-prettier'

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '*.config.{js,ts}',
      'vite.config.ts',
      'tailwind.config.js',
      'postcss.config.js',
      'tests-e2e/playwright-report/**',
      'i18n-missing-*.json',
    ],
  },
  js.configs.recommended,
  ...vue.configs['flat/recommended'],
  ...vueConfig({
    extends: ['recommended'],
    parserOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      extraFileExtensions: ['.vue'],
    },
  }),
  {
    languageOptions: {
      globals: {
        // 让所有浏览器变量在 ESLint 里可见
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        setInterval: 'readonly',
        setTimeout: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly',
        crypto: 'readonly',
        URL: 'readonly',
        WebSocket: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLElement: 'readonly',
        FormData: 'readonly',
        Event: 'readonly',
        AbortController: 'readonly',
        MutationObserver: 'readonly',
        ResizeObserver: 'readonly',
      },
    },
    rules: {
      // TS 用 strict，业务代码 a lot of `as any`，暂时降级到 0
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-unused-vars': 'off',
      // console.* — 应用 code 内允许，警告要让保持可见
      'no-console': 'off',
      // vue 规则——先关掉导致噪音的：
      'vue/multi-word-component-names': 'off',
      'vue/html-self-closing': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/attributes-order': 'off',
      'vue/v-on-event-hyphenation': 'off',
      'vue/no-v-html': 'warn',
      'vue/no-mutating-props': 'warn',
      'vue/require-default-prop': 'off',
      'vue/return-in-computed-property': 'off',
      // 业务规则
      'no-debugger': 'warn',
      // 渐进式：先 warning（项目里 14 处 alert 临时兜底用），等全局 toast 系统上线后改 error
      'no-alert': 'warn',
      'prefer-const': 'warn',
      'eqeqeq': ['error', 'smart'],
      // process 在浏览器里理论上不该有，但 SSR/Vite 有时会注入，先 warn
      'no-undef': 'off',
      // computed 内副作用是 warning（容易踩到的性能坑）
      'vue/no-side-effects-in-computed-properties': 'warn',
      // 解构错误有时并非真正"lost cause"，先 warn
      'preserve-caught-error': 'warn',
      // 一些空 catch 是有意为之（fire-and-forget）
      'no-empty': 'warn',
      // 一些 type 写法不是真问题
      '@typescript-eslint/prefer-as-const': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      // 已声明但赋值在外的情况（如模块级 timer）
      'no-unassigned-vars': 'warn',
      // 变量未初始化为 undefined 但工具不认可能是 false positive
      'no-unassigned-vars': 'warn',
    },
  },
  {
    // 测试文件
    files: ['tests/**/*.ts', 'tests-e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
      'no-empty': 'off',
    },
  },
  {
    // Supabase Edge Functions：deno 风格 + 不同 globals
    files: ['supabase/functions/**/*.ts'],
    languageOptions: {
      globals: {
        Deno: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
      },
    },
    rules: {
      // Edge functions 常用 @ts-nocheck 跳过类型（Deno 调试时）
      '@typescript-eslint/ban-ts-comment': 'off',
      'no-console': 'off',
      // node 风格 require 也常用
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // Prettier 在最后，确保不和 ESLint 冲突
  prettier,
]	
