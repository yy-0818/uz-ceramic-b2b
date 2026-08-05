# 代码规范 (ESLint + Prettier)

本项目用 ESLint 9 (flat config) + Prettier 3 + lint-staged + husky 做代码规范。

## 工作流
- **commit 时**：husky 自动跑 `lint-staged`，仅 fix 暂存的文件（prettier + eslint --fix）
- **PR 时**：CI 跑 `npm run type-check` + `npm test` + `npm run lint:check` + `npm run format:check` + `npm run build`
- **CI 是非阻断的**：现有遗留的 143 个 warnings 不阻断 PR，但 lint:check 必须 0 errors 才通过（已达成）

## 命令
| 命令 | 作用 |
|---|---|
| `npm run lint` | 逐文件 lint（warning 含信息） |
| `npm run lint:fix` | 自动修复（prettier + eslint --fix） |
| `npm run lint:check` | CI 模式（--max-warnings=999，仅检查 error） |
| `npm run format` | 全项目格式化 |
| `npm run format:check` | 检查格式（CI 中跑） |
| `npm run i18n:check` | i18n 缺失检查（不阻断，但会上报 artifact） |
| `npm run i18n:check -- --strict` | i18n 严格模式（命中缺漏即 fail） |

## 当前规则
- `no-explicit-any`: off（业务代码大量用）
- `no-undef`: off（vite SSR 注入）
- `vue/no-v-html`: warn（聊天组件里有，但没有注入风险）
- `no-alert`: warn（14 个临时兜底，等全局 toast 上线后改 error）
- 全局常驻 143 个 warnings 不强制清理，留给后续 sprint 逐步消化

## 添加新依赖
给开发者说：用 `pnpm` 或 `npm`，但**提交前务必运行 `npm run lint:fix`** — 减少 PR review 时长。
