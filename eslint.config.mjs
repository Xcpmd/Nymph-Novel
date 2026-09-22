import next from 'eslint-config-next';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * ESLint 扁平配置。
 * Next 官方配置提供 React、Hooks、Accessibility 与 TypeScript 规则，
 * 这里在其之上追加项目自己的约束。
 */
const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      '.next-old*/**',
      'out/**',
      'dist/**',
      'data/**',
      'coverage/**',
      'next-env.d.ts',
    ],
  },
  ...next,
  ...nextTypescript,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // 未使用的参数与变量用下划线前缀显式忽略
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-console': 'off',

      /**
       * 本项目是纯本地应用，页面数据来自本机接口与文件系统，没有服务端数据层。
       * 各页面在挂载时通过 useEffect 触发一次异步加载，setState 发生在 await 之后，
       * 并不是同步级联渲染。该规则在这个场景下属于误报，因此关闭。
       * 真正的派生状态问题已按 React 官方建议改为直接计算取值，不依赖该规则兜底。
       */
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: ['src/lib/repo/*.ts', 'src/lib/db/*.ts'],
    rules: {
      // 数据访问层需要按列名动态拼装 SQL，字段名全部来自内部的常量表
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];

export default config;
