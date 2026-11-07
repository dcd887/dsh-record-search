# dsh-record-search · 会话记录搜索

给 Harness 加一个「输一个字或词，匹配所有历史会话」的搜索。两半：

| 入口 | 位置 | 用法 |
|---|---|---|
| 侧栏面板 | 侧栏全局面板图标（放大镜，order 40） | 点开 → 输入即时搜，结果按会话分组，点标题直接跳到那次会话 |
| 工具 | `record_search` | 聊天里说「搜 XX」，我调它，返回命中会话 + 片段 |

面板行为：

- 默认最多 `maxSessions`（40）个会话 × `maxHits`（3）条片段，按最近命中时间排序
- 结果底部「**展开全部 N 个会话**」→ 重新请求 `limit=200&per=10`（全部会话 × 每会话 10 条片段），再点「收起」回到默认
- 来源筛选胶囊：全部 / 我的消息 / 回复 / 工具输出（对应 `kinds=user|assistant|tool`）
- 改查询词会自动收起（避免展开态被带进新搜索）
- **点片段 = 跳到那句话**：点会话标题只打开会话；点某一条片段则打开会话并定位到那条消息（滚动到中央 + 蓝色描边闪一下）

### 「定位到那句话」怎么实现的

宿主没有开放「按 seq 滚动到消息」的 API，所以走四步（每一步都写进 `/record-search/jumps` 自检日志）：

1. `ctx.get('uiWorkspace').openSession(sessionId)` —— 切到该会话（和侧栏点一下同一条路径），并用 `uiWorkspace.selection` 轮询确认**选择真的变了**（没变就报 `selection-not-changed`，不把用户丢在错误会话里）
2. `ctx.get('sessions').using(id, {source:'gateway'}, ref => ref.binding.session.loadThrough(seq))` —— 用会话自己的历史加载把目标事件拉进已加载窗口（旧消息不加载就不在 DOM 里），6 秒超时兜底
3. 在会话 DOM 里找那一行：先按节点 key 精确匹配（`data-chat-node-key` 形如 `4:user<messageId>`、`13:input-message<id>`、`9:tool-call<callId>`），不中再退化到 80 字文字探针（两边都归一化成「只留字母/数字/汉字」后比对）
4. **折叠组的行高度为 0，`scrollIntoView` 对它无效**：先用 `getBoundingClientRect().height === 0` 判断是否被折叠，然后从行本身往上逐层收集 `button[aria-expanded="false"]`，**点一个验一个**（不再被折叠就停），再 `scrollIntoView({block:'center'})` + 260ms 后复查是否真的进了视口，最后描边闪 1.8 秒

踩到的坑（2026-10-25 实测）：工具/思考被宿主收进 `turn-process` 折叠组（`data-chat-flow-kind="turn-process"` + `data-turn-process-member`），我第一次按「折叠组的直接子按钮」猜选择器，`expanded:false` 没命中 → 找到行、也滚了，但滚的是 0 高元素，肉眼看不到。**「在视口外」和「被折叠成 0 高」必须分开判断**，否则会为前者去乱点别人的折叠开关。

天然限制：目标在更深层折叠（工具卡片自身的参数折叠）时可能只展开外层；历史特别长时 `loadThrough` 可能超时，此时只打开会话不滚动——两种情况都不会报错，只在日志里留 `collapsed:true`。

## 为什么自己做索引

Harness 自带的 `session.search` 走 SQLite FTS5 + `unicode61` 分词器，**中文被切成一整段 token**：

```
插入 '海关稽查专业本科'  →  搜 "海关" 0 命中, 搜 "海" 0 命中, 搜 "海关稽查" 0 命中
```

而且这一行默认 `openAt: never`（内容搜索根本没开，侧栏只匹配标题）。
所以这里用**字面量子串**匹配（`String.prototype.indexOf`，大小写折叠），单个汉字、任意词都能中。

## 数据与索引

- 读取：`ctx.sessionQuery.readSession(id)`（Harness 自己的会话读取路径，不碰磁盘上的 zstd 分帧）
- 收录：用户消息、助手正文（不含 reasoning / tool-call 参数）、工具输出（截前 600 字）、会话标题
- 缓存：`<DSH_HOME>/cache/record-search/index.json.gz`，按会话文件 `mtime+size` 增量重建
- 首次构建实测：147 个会话 / 25,852 条记录 / **约 59 秒**；之后增量通常 1 秒内
- 读取大面积失败的构建不会覆盖上一份好索引

## 路由

同源 HTTP（`ctx.webServer.register`，前缀 `/record-search`）：

| 路由 | 说明 |
|---|---|
| `GET /record-search/status` | 索引状态：`indexed/building/progress/sessions/docs/buildMs/stats/failures/instance` |
| `GET /record-search/search?q=&limit=&per=&kinds=` | 搜索；`kinds` 取 `user,assistant,tool` 逗号分隔 |
| `GET\|POST /record-search/rebuild` | 后台重建 |

## 配置（`cordis.patch.yml`）

```yaml
cacheDir: ''          # 空 = <DSH_HOME>/cache/record-search
sessionsDir: ''       # 空 = <DSH_HOME>/sessions
refreshMs: 60000      # 距上次构建超过这个时间，下一次搜索顺手后台增量
maxSessions: 40       # 结果最多显示多少个会话
maxHits: 3            # 每个会话最多几条片段
snippetChars: 110     # 片段长度
toolOutputChars: 600  # 工具输出进索引的截断长度
```

## 结构

```
entry.js        入口薄壳：宽松 Config + 按 mtime 动态 import impl.js（改 impl.js 不用重启）
impl.js         宿主：索引构建/增量、搜索、HTTP 路由、record_search 工具
client.js       浏览器半侧：locale 词典、样式、侧栏图标、main 面板
cordis.patch.yml
```

补充：`client.js` 里跳转会话用 `ctx.get('uiWorkspace').openSession(id)`（和侧栏列表点一下是同一条路径）。
