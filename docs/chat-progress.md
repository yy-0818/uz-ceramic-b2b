# 在线客服聊天 — 实施进度

## Phase 0 — 基础设施（已完成）

- [x] DB 表：`chat_conversations` / `chat_conversation_members` / `chat_messages` / `chat_presence`
- [x] 私有 bucket：`chat-attachments`（Phase 2 才用，提前建好）
- [x] RLS：所有聊天权限统一以 `chat_conversation_members` 为唯一边界
  - 客户只看自己父账号子树的会话
  - staff 必须被显式加入成员才能看到客户会话
  - 消息插入仅 sender = auth.uid()
- [x] Realtime 订阅：`chat_messages` / `chat_conversation_members` / `chat_presence` 加入 `supabase_realtime`
- [x] `partial unique index`：同一 `(account_id, subject_order_id)` 只允许一个 open 会话
- [x] `client_message_id` 唯一约束：发送幂等，重试不会重复
- [x] TypeScript 类型：`chat_*` 表写入 `src/types/database.ts`
- [x] i18n 键（zh / ru / uz）

## Phase 1 — 私聊 MVP（已完成）

- [x] `useChat` composable
  - `fetchConversations()` —— 列表 + 未读 + 最后一条消息
  - `ensureConversation({ account_id, subject_order_id })` —— 找/创建
  - `fetchMembers()` / `fetchMessages()` / `sendMessage()` / `markRead()`
  - `heartbeat()` / `fetchPresence()`
  - `subscribeConversation()` —— realtime 控制器
- [x] 基础组件
  - `ChatBubble` 文本消息气泡（左右 / 已读回执 / 失败重试）
  - `ChatComposer` 输入区（Enter 发送 / Shift+Enter 换行）
  - `ChatAvatar` 首字母 + 角色色
  - `ChatStatusDot` 在线 / 离开 / 离线
  - `ChatDateDivider` 今日 / 昨日 / 日期
  - `ChatTyping` "正在输入"占位（Phase 2 接入）
  - `ChatOrderCard` 订单卡片消息（Phase 2 接入，目前未使用）
- [x] 容器组件
  - `ChatPanel` —— 单会话（拉历史 + 实时增量 + 乐观发送 + 失败重试 + 标记已读 + 心跳）
  - `ChatConversationList` —— 左侧目录
- [x] 页面
  - `views/chat/ChatListPage.vue` —— 桌面端左 280 列表 + 右详情；移动端分屏切换
  - 路由 `/chat`，所有角色可访问
  - 移动端底部 nav 已加入 `/chat`
- [x] 订单详情页底部嵌入 ChatPanel
  - 同一 `(account_id, subject_order_id)` 自动归到同一会话
  - 顶部副标题显示「会话关联订单 xxx」
- [x] `useAuth` 退出登录时清掉 chat 缓存
- [x] 类型检查 + build 通过

## Beta 测试用例

1. 客户登录 → 进入 `/orders/:id` → 底部聊天自动 ensureConversation
2. 客户发送文字 → 消息流立即出现（pending）→ realtime 推回真实消息 → 替换为已发送
3. staff （admin / checker）登录 → `OrderDetailPage` 同样进入，自动加入会话
4. 退出 / 重进 → 消息历史按时间线显示，最后一条消息下方有"已读"标记
5. 浏览器断网 → 顶部显示 "连接失败，正在重试…"
6. 同一客户的不同订单 → 自动各开一个会话

## Phase 1 已知设计权衡

- **未读数** 用加入后非自己消息总数估算（首次 `last_read_message_id` 之后到当前的消息），不是按位点精确计算。Phase 2 优化为 `last_read_message_id` 时间点。
- **Typing 状态** 暂未接 realtime presence，UI 占位为静态组件。
- **消息签名** Phase 1 仅文本和 system；图片 / 表情 / 订单卡片占位组件已建好但不通过消息总线。
- **assigned_to** 字段保留，方便将来由 admin / 调度员手动领取会话。
- **presence channel** 显示离线基于 `last_read_at` 估算，Phase 2 接入 `chat_presence` 实时在线状态。

## Phase 2 — 多媒体 / 订单卡片（下一步）

- [ ] `message_attachments` 表 + 私有 bucket 上传
- [ ] 图片消息：ChatPanel 拖拽 / 粘贴 / 上传
- [ ] 订单卡片消息：OrderDetailPage 加"发送订单卡片"按钮
- [ ] 表情回应（thumbs up / ok / love）
- [ ] 已读位点精确化（接 `last_read_message_id` 时间点）
- [ ] 移动端 emoji panel

## M1 — 后台独立聊天窗口 + 客服工作台（已完成）

- [x] DB 迁移 `0018_chat_workspace.sql`
  - [x] RLS 放开：staff 看所有 `chat_conversations`
  - [x] 客服首次进入会话触发 `fn_chat_autojoin_staff_safe` → 自动加入成员表
  - [x] 触发器 `trg_chat_conv_limit_staff_update`：staff 仅允许改 `status` / `assigned_to`
  - [x] 新建 `chat_message_recipients` 占位（per-user read 后面接）
  - [x] RPC `rpc_chat_admin_list_conversations(status, limit, offset)`：列表 + 最后消息 + 我的未读
- [x] `useChat` 扩展
  - `listAdminConversations(status)` / `groupByAccount(rows?)` / `setConversationStatus()` / `assignConversation()`
  - `ensureStaffConversation()`  / `batchSetStatus()` / `batchReassign()`
- [x] 路由 `/admin/chat`，meta `roles: ['admin','checker','finance','warehouse']`
- [x] `AppLayout` 导航：staff 角色看见"客服工作台"（Headphones 图标）；底部 nav 也加入
- [x] `views/admin/StaffChatWorkspacePage.vue`
- [x] `ChatWindow.vue` 浮窗组件
- [x] i18n 键补齐 zh/ru/uz：workspace / filterAll/Open/Closed / searchAccount / closeConversation / reopenConversation / assignSelf / unassign / openWorkspace / staffGroups / toggleGroup

## M1.5 — 批量操作 (已完成)

- [x] 工作台顶部工具栏新增"批量操作"模式 (`batchMode` toggle)
- [x] 多选会话：每行显示 checkbox 状态 (`onPickConversation` 在 selectMode 走 add/remove 路径)
- [x] 客户分组行多一个"全选该客户所有会话"快捷按钮
- [x] 底部固定浮动条显示：批量关闭 / 批量重开 / 选择客服批量指派
- [x] `useChat.batchSetStatus(ids, status)` / `useChat.batchReassign(ids, staffId)`
- [x] `useAuth.users` 拉 `role in (admin,checker,finance,warehouse)` 作为指派下拉
- [x] i18n 键：batchMode / selectedN / deselectAll / selectAllInGroup / confirmBatchClose / confirmBatchAssign

## M2 — 多媒体 / 订单卡片（已完成）

- [x] DB 迁移 `0019_chat_attachments.sql`
  - [x] `chat_messages.message_kind` 列 (`text|image|order_card`) + 索引
  - [x] `chat_message_attachments` 表 (storage_path, mime, size_bytes, w/h) + RLS
  - [x] `chat_message_metadata` 表 (JSON payload, 装订单卡片 order_id)
  - [x] `chat-attachments` bucket RLS 重写 (staff 任意路径 / 客户限自己主账号)
  - [x] RPC `rpc_chat_create_image_message()` (idempotent by client_message_id)
  - [x] RPC `rpc_chat_create_order_card_message()` (idempotent)
- [x] `useChatUpload` composable
  - `validateChatImage(file)` / `uploadImage({conversation, account, file, clientMessageId})`
  - `getSignedUrl(path, force?)` (5min TTL 缓存)
  - `preloadSignedUrls(paths)`
- [x] `useChat` 扩展
  - `fetchAttachments(messageIds)` / `fetchMetadata(messageIds)`
  - `sendOrderCard(conversationId, orderId, clientMessageId?)`
- [x] `ChatBubble` 支持 image / order_card 气泡；接收 attachments + signedUrls + orderCardInfo
- [x] `ChatComposer` 重写
  - 图片按钮 + 多图预览 (本地 blob URL)
  - 粘贴图片支持 (`@paste`)
  - emoji 按钮 (Phase 2.5 占位)
- [x] `ChatPanel` 集成
  - pendingUploads 列表 + 上传进度 + 失败重试
  - reloadExtras 拉附件/元数据 + 预签 URL
  - `sendOrderCardHandler` prop 触发外部函数（OrderDetailPage 提供）
- [x] OrderDetailPage 接入
  - `sendOrderCard()` 调 `chat.sendOrderCard(conv.id, order.id)`
  - `orderCardInfo` (order_no, status, item_count, total_boxes, total_amount)
- [x] 全局 `ChatWindow`
  - AppLayout 挂一份
  - route 监听 + popstate：订单页自动切换 context；其他页 fallback general (subject_order_id=null)
  - `/chat` 和 `/admin/chat` 时自动隐藏（避免重复）
- [x] i18n 键：attachImage / attachEmoji / sendOrderCard / imageLoadFailed / uploadingImage

## Phase 3 — 服务化能力

- [x] Typing 状态实时广播
  - [x] DB: `chat_typing` 表 (PK conversation_id+user_id, expires_at 6s TTL)
  - [x] `useChat.notifyTyping(conversationId)` / `useChat.fetchTyping(conversationId)`
  - [x] ChatPanel 订阅 `chat_typing` realtime + 渲染 ChatTyping
  - [x] ChatComposer input -> emit('typing') -> 5s 节流
  - [x] ChatTyping 显示对方姓名
- [x] 已读位点精确化
  - [x] DB: `rpc_chat_mark_read(p_conversation, p_message_id)` 原子写位点 + per-message read punct
  - [x] `useChat.markRead` 走 RPC
  - [x] `rpc_chat_admin_list_conversations` 升级未读 = `last_read_message_id` 之后 + 自己 sender 排除
  - [x] `chat_message_recipients` 表 (0019 引入) 实际写入
- [x] 消息搜索
  - [x] DB: `rpc_chat_search_messages(keyword, account_id?, limit)` 同时搜 body / order_no / account_name
  - [x] `useChat.searchMessages()` + `ChatSearchHit` 类型
  - [x] 工作台顶部"搜消息"按钮 + 浮层显示结果 + 点击定位到会话
- [x] i18n 键：searchMessages / searchResults / noSearchResults / typingSuffix / typingStaff / typingCustomer

## Phase 3 — 剩余

- [x] 客服转接 / 接管
  - [x] DB: `rpc_chat_join_conversation(conversation_id)` staff 加入 + assigned_to 默认给自己
  - [x] DB: `rpc_chat_transfer_conversation(conversation_id, to_staff_id|null)` 转给同事 / 取消
  - [x] ChatPanel 右上角 actions: 接管自己 / 转给其他客服 下拉菜单
  - [x] OrderDetailPage 嵌入模式顶部也加接管按钮
- [x] 消息撤回 / 编辑
  - [x] DB: `rpc_chat_edit_message(message_id, new_body)` 文本 5 分钟内可改 + admin 例外
  - [x] DB: `rpc_chat_soft_delete_message(message_id)` sender 自己 2 分钟内可撤 + admin 例例
  - [x] `useChat.editMessage()` / `deleteMessage()`
  - [x] ChatBubble: hover 显示编辑 / 撤回按钮；显示"已编辑"/"已撤回"标签
  - [x] ChatPanel: 编辑条 (inline textarea) + 编辑中消息不可再编辑
  - [x] subscribeConversation 增加 onUpdated 第三回调，UPDATE 实时替换本地消息
- [x] 订单状态变更 → 系统消息
  - [x] DB: `fn_chat_post_system_message(conversation_id, body, meta)` 内部函数
  - [x] DB: `trg_order_status_chat_notify` AFTER UPDATE OF status on orders → 写系统消息
  - [x] DB: `rpc_chat_post_system_message(conversation_id, body, meta)` staff 手动补一句
  - [x] ChatPanel: 📣 按钮 → prompt → 调 RPC
  - [x] ChatBubble: `message_type === 'system'` → 居中卡片渲染
  - [x] ChatPanel.rows: 接受 system 消息渲染
  - [x] i18n: sysOrder* / postSystem* 文案
- [ ] 在线状态接入 realtime presence（替换 last_read_at 估算）— Workspace 不必要
- [ ] 离线消息通知（如果产品方向支持）
- [x] 通知中心 (Phase 5)
  - [x] DB: `notifications` 表 + RLS + 索引 (user_id, created_at)
  - [x] DB trigger: `trg_order_status_notify` → 通知给订单 owner + 关联客服
  - [x] DB trigger: `trg_chat_message_notify` → 通知给 conversation members (system 跳过)
  - [x] DB RPC: `rpc_notifications_list / unread_count / mark_read / mark_all_read`
  - [x] `useNotifications` composable: list / unread / realtime / 浏览器 Notification
  - [x] `NotificationBell` 组件: bell icon + badge + dropdown
  - [x] AppLayout 顶栏接入
  - [x] document.title 加未读数 (仅 tab 标题)
  - [x] i18n: notif.* (zh/ru/uz)
- [x] 通知 i18n 化 + 独立页面 (Phase 6)
  - [x] DB: 改 trigger 写 `payload.kind_key` + `status_key` + 英文 fallback (title/body)
  - [x] i18n: `notif.chat_message.*` / `notif.order_status.*` 模板 - 支持 `{var}` 替换 + 多态选择
  - [x] i18n helper: `format()` 支持 object 模板按 `status_key` 选择 + 子模板再 format
  - [x] `useNotifications.setI18nRenderer(fn)` — 注入 kindKey → {title, body} 渲染器
  - [x] `NotificationBell` 内容走 `renderText()` (英文 fallback 兜底)
  - [x] 浏览器 `Notification` 也走 i18n 渲染
  - [x] 独立页面 `/notifications` - 全部/未读 tab + 类型 chip + 加载更多
  - [x] router: `/notifications` 路由 (所有登录用户)
  - [x] Bell dropdown 底部 "查看全部" 链接
- [x] Phase 7: 聊天拆分独立 + 订单卡片实时状态
  - [x] DB: `rpc_chat_create_order_card_message` 写入 metadata 快照 (order_no / status / total_amount)
  - [x] DB: `orders` 表 realtime publication 兜底注册
  - [x] 新增 `useOrderStatusCache` composable — 全局单例, 订阅 realtime + 提供 hydrate
  - [x] `ChatOrderCard` 实时显示订单最新状态 + 总金额 + 单号 + 状态徽章着色
  - [x] `OrderDetailPage` 移除内嵌 ChatPanel
  - [x] `OrderDetailPage` 操作区: 添加「沟通客服」「分享订单」两个按钮 (openChat / onShare)
  - [x] `OrderDetailPage` 右下角浮动按钮: 「分享订单」+「沟通」圆形按钮
  - [x] `OrderDetailPage` 加载订单后立即 `statusCache.setImmediate` 让首屏 ChatOrderCard 初始值正确
  - [x] `ChatListPage` unified — 按角色自动切换客户一对一 / 后台一对多 (复用 StaffChatWorkspacePage)
  - [x] `ChatListPage` 支持 `?conversation=uuid` 深链接自动选中 (订单分享跳转用)
  - [x] router: 移除 `/admin/chat`, 统一为 `/chat`
  - [x] AppLayout nav: 桌面侧栏 + 移动底部 dock 全部指向 `/chat`
  - [x] i18n: chat.openChat / chat.shareOrderCard (zh/ru/uz)
- [x] Phase 7 polish: 统一浮窗按钮入口
  - [x] ChatWindow 在订单详情页路径 (`/orders/:id`) 自动 hide — 页面已有沟通/分享按钮
  - [x] ChatWindow 浮窗 header 加「分享订单」按钮 (Send icon), 仅 subject_order_id 存在时显示
  - [x] ChatWindow share 按钮: 调 sendOrderCard, sharing 状态防重复
  - [x] OrderDetailPage 移除独立浮动按钮 — 改用 AppLayout 全局 ChatWindow
  - [x] OrderDetailPage 保留操作区「沟通客服」+「分享订单」两个 button
  - [x] ChatPanel `reloadExtras` 内 hydrate orderCards 涉及的 order_ids (批量, dedup)
  - [x] useOrderStatusCache `hydrate` dedup: 已 cache 或正在 inflight 的订单直接跳过
  - [x] ChatOrderCard 实时渲染: 状态 + order_no + total_amount 全部走 realtime
- [x] Phase 8: Emoji 选择器 + 草稿自动保存
  - [x] `ChatEmojiPanel` 新组件 — 4 分类 (smile/hand/symbol/object) + 最近用过 (localStorage 持久化, 上限 24)
  - [x] 外部点击关闭 (mousedown 检测)
  - [x] `ChatComposer` emoji 按钮改成面板 toggle — 光标位置插入
  - [x] `ChatComposer` 草稿自动保存 — `localStorage[chat:draft:<conversationId>]` 300ms debounce
  - [x] `ChatComposer` 发送成功 / 切会话时清掉草稿
  - [x] `ChatPanel` 把 `conversation?.id` 透传到 `draftKey`
  - [x] i18n: chat.emojiEmpty (zh/ru/uz)
- [x] Phase 9: 消息引用回复 (quote reply)
  - [x] DB schema 已支持 `reply_to_id` — `sendMessage(conversationId, body, clientMessageId, replyToId)` 补齐参数
  - [x] ChatBubble 新 prop `replyTo: ChatMessage | null` — 文本气泡上方渲染被引用消息摘要 + sender
  - [x] ChatBubble hover 操作: 在气泡外侧显示「引用回复」按钮 (CornerUpLeft 图标)
  - [x] ChatPanel `replyTo` ref — 选中要回复的消息, 渲染 composer 上方引用预览条
  - [x] ChatPanel `replyFor(m)` helper — 从本地 messageMap (含 pending) 解析被引用消息
  - [x] ChatPanel `replySummary(m)` helper — 文本/图片/订单/已撤回分别渲染摘要
  - [x] onSend / onRetry 都带 replyToId
  - [x] ChatComposer textarea 加 `data-chat-composer` — `onReply` 自动聚焦
  - [x] i18n: reply / replyTo / cancelReply / replyImage / replyOrderCard / replyDeleted (zh/ru/uz)
- [x] Bugfix: OrderDetailPage 重复声明 `const chat = useChat()` 导致 Vite 模块动态导入失败 → "Failed to fetch dynamically imported module"
  - [x] Bugfix: OrderDetailPage Section 4 操作按钮缺少 `</CardContent></Card>` 闭合导致 Vite "Element is missing end tag" → 操作按钮包到主 Card 内, 加 border-t 分隔
- [x] Phase 10: 聊天中心搜索
  - [x] ChatConversationList: 会话列表顶部搜索框, 实时过滤 (account name / order no / last message body), 200ms debounce
  - [x] ChatConversationList: 无结果时显示 noResults / noResultsHint; 搜索图标 Search icon
  - [x] ChatPanel: 消息历史顶部搜索框, 搜索时匹配消息 body 高亮 (黄色背景 `<mark>`)
  - [x] ChatBubble: 新 prop `searchQ`, body 文本用 `v-html` + `highlightBody()` 渲染高亮 HTML
  - [x] ChatPanel: 搜索框右侧清除按钮 (有搜索词时显示)
  - [x] i18n: searchConversations / noResults / noResultsHint / searchMessages / clearSearch (zh/ru/uz)
