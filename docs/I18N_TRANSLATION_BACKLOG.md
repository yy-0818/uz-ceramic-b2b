# i18n 待翻译清单（缺口报告）

> 截至 2026-08-05。自动生成 by `npm run i18n:check`。

## 现状
- `zh.ts`: 678 keys（source of truth）
- `ru.ts`: 519 keys（缺 160）
- `uz.ts`: 519 keys（缺 161）

## 缺口策略
- `lib/i18n.ts` 的 fallback 链：`[当前 locale, ru, uz, zh]`
- 当用户切到 ru/uz，但某 key 在该语言包里没有时，**自动 fallback 到 zh**（线上不会显示缺失标记）
- 这是**短期可接受**的，但**长期**必须补齐（用户体验上用户会看到中文）
- CI **不阻断** PR，但会在 artifact 留报告（`i18n-missing-*.json`）
- 跑 `npm run i18n:check -- --strict` 可以手动验证补齐

## 优先补的 key（按使用频次区域）
1. **admin.accounts.*** （47 条，账号管理后台）—— 高频，员工每天用
2. **admin.assignPage.*** （30 条，库存分配）—— 高频
3. **customer.productsAll.*** （30+ 条，商品管理）—— 高频
4. **customer.catalog.*** （10 条，前台浏览）
5. **chat.*** （5 条，聊天）
6. **invite.*** （15 条，邀请流程）
7. **common.*** （5 条，公共文案）

## 翻译时建议
- 用 ru 当乌兹别克业务主要语言（俄罗斯语是商务通用语）
- 乌语 uz 是本地母语，要让本地运营团队核对
- 占位符如 `{name}`、`{p}` 不要翻译
- 多态 selector `{ pending: '...', shipped: '...' }` 结构必须保留下，**只翻译值**

## 工作流
1. 从 i18n-missing-*.json 拿到 zh-only 清单
2. 与懂俄语/乌语的同事对接获取翻译
3. 在 ru.ts / uz.ts 同步添加
4. 跑 `npm run i18n:check -- --strict` 通过
5. 提交 PR
