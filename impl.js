/**
 * 会话记录搜索 —— 宿主半侧实现。
 *
 * 为什么自己建索引：这个版本自带的 `session.search` 走 SQLite FTS5 的 unicode61 分词器，
 * 中文会被切成一整段 token（实测：库里存「海关稽查专业本科」时，搜「海关」「海」都命不中），
 * 而且默认 `openAt: never` 根本没开。这里直接用字面量 substring 匹配，任意字/词都能中。
 *
 * 数据来源：`ctx.sessionQuery.readSession(id)` 逐会话读日志（Harness 自己的读取路径，
 * 不碰磁盘上的 zstd 分帧格式）。索引缓存在 <DSH_HOME>/cache/record-search/index.json.gz，
 * 按会话文件的 mtime+size 做增量。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { gzipSync, gunzipSync } from 'node:zlib'

const ROUTE = '/record-search'
const INDEX_VERSION = 3

const DEFAULTS = {
  cacheDir: '',
  sessionsDir: '',
  refreshMs: 60000,
  maxSessions: 40,
  maxHits: 3,
  snippetChars: 110,
  toolOutputChars: 600,
}

/** 只保留索引里有用的配置，数值统一收敛到安全区间。 */
function normalizeConfig(raw) {
  const cfg = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) }
  return {
    cacheDir: typeof cfg.cacheDir === 'string' ? cfg.cacheDir.trim() : '',
    sessionsDir: typeof cfg.sessionsDir === 'string' ? cfg.sessionsDir.trim() : '',
    refreshMs: clampInt(cfg.refreshMs, 5000, 3600000, DEFAULTS.refreshMs),
    maxSessions: clampInt(cfg.maxSessions, 1, 200, DEFAULTS.maxSessions),
    maxHits: clampInt(cfg.maxHits, 1, 10, DEFAULTS.maxHits),
    snippetChars: clampInt(cfg.snippetChars, 40, 400, DEFAULTS.snippetChars),
    toolOutputChars: clampInt(cfg.toolOutputChars, 80, 4000, DEFAULTS.toolOutputChars),
  }
}

function clampInt(value, min, max, fallback) {
  const n = typeof value === 'number' ? Math.floor(value) : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function resolvePaths(cfg) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const cacheDir = cfg.cacheDir || join(home, 'cache', 'record-search')
  const sessionsDir = cfg.sessionsDir || join(home, 'sessions')
  return { cacheDir, sessionsDir, cacheFile: join(cacheDir, 'index.json.gz') }
}

function clip(text, max) {
  const s = String(text ?? '')
  return s.length <= max ? s : s.slice(0, max) + '…'
}

/** 消息 content 里所有 text 块拼起来；reasoning / tool-call 之类不参与索引。 */
function textOfBlocks(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (!block || block.type !== 'text') continue
    const text = typeof block.text === 'string' ? block.text.trim() : ''
    if (text) parts.push(text)
  }
  return parts.join('\n').trim()
}

/**
 * 把一个会话日志折成可搜索文档：用户消息、助手正文、工具结果摘要、会话标题。
 * @param snapshot - `readSession` 的返回值。
 * @param cfg - 归一化后的配置。
 */
function docsFromSnapshot(snapshot, cfg) {
  const events = Array.isArray(snapshot?.events) ? snapshot.events : []
  const docs = []
  let title = ''
  let firstUser = ''
  for (const event of events) {
    const type = event?.type
    const time = typeof event?.time === 'number' ? event.time : 0
    if (type === 'session/title') {
      const value = event.data?.title
      if (typeof value === 'string' && value.trim()) title = value.trim()
      continue
    }
    if (type === 'user/message') {
      const text = textOfBlocks(event.data?.content)
      if (!text) continue
      if (!firstUser) firstUser = text
      docs.push({ seq: event.seq, kind: 'user', time, text, id: String(event.data?.id ?? '') })
      continue
    }
    if (type === 'assistant/message') {
      const text = textOfBlocks(event.data?.message?.content)
      if (text) docs.push({ seq: event.seq, kind: 'assistant', time, text, id: String(event.data?.message?.id ?? '') })
      continue
    }
    if (type === 'tool/result') {
      const text = textOfBlocks(event.data?.message?.content)
      if (text) {
        docs.push({
          seq: event.seq,
          kind: 'tool',
          time,
          text: clip(text, cfg.toolOutputChars),
          id: String(event.data?.message?.toolCallId ?? event.data?.toolCallId ?? ''),
        })
      }
    }
  }
  const lastAt = docs.length ? docs[docs.length - 1].time : 0
  if (!title) title = clip(String(firstUser).replace(/\s+/gu, ' ').trim(), 48) || '(未命名会话)'
  return { title, docs, lastAt }
}

/**
 * 会话文件表：目录名 → mtime/size，用于增量重建。
 * 会话库布局是 <sessionsDir>/<workspace>/<sessionId>/{session.*.jsonl.zstd}，
 * 目录名偶尔带 `session-` 前缀，两个键都登记。
 */
function sessionFileMap(sessionsDir) {
  const map = new Map()
  let workspaces
  try {
    workspaces = readdirSync(sessionsDir)
  } catch {
    return map
  }
  for (const workspace of workspaces) {
    const workspaceDir = join(sessionsDir, workspace)
    let sessions
    try {
      sessions = readdirSync(workspaceDir)
    } catch {
      continue
    }
    for (const entry of sessions) {
      const sessionDir = join(workspaceDir, entry)
      let files
      try {
        files = readdirSync(sessionDir)
      } catch {
        continue
      }
      for (const file of files) {
        if (!file.startsWith('session.') || !file.includes('.jsonl')) continue
        let stat
        try {
          stat = statSync(join(sessionDir, file))
        } catch {
          continue
        }
        const record = { mtimeMs: stat.mtimeMs, size: stat.size }
        map.set(entry, record)
        const bare = entry.replace(/^session-/, '')
        if (bare !== entry) map.set(bare, record)
      }
    }
  }
  return map
}

/** 有界并发跑一组任务，避免一次把 147 个日志全塞进内存。 */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

function snippetFor(text, lower, term, chars) {
  const index = term ? lower.indexOf(term) : -1
  if (index < 0) return clip(String(text).replace(/\s+/gu, ' ').trim(), chars)
  const source = String(text)
  const start = Math.max(0, index - Math.floor(chars / 3))
  const slice = source.slice(start, start + chars).replace(/\s+/gu, ' ').trim()
  return (start > 0 ? '…' : '') + slice + (start + chars < source.length ? '…' : '')
}

function lowerOf(doc) {
  if (doc.lower === undefined) doc.lower = String(doc.text).toLowerCase()
  return doc.lower
}

/** 只留字母/数字/汉字：用于在会话 DOM 里按文字定位（渲染后会丢掉 markdown 符号）。 */
function normalizeForMatch(text) {
  return String(text).replace(/[^\p{L}\p{N}]+/gu, '')
}

/** 命中位置附近的一段原文（不带省略号），给客户端做 DOM 文字定位用。 */
function probeFor(text, lower, term, chars) {
  const index = term ? lower.indexOf(term) : -1
  if (index < 0) return normalizeForMatch(String(text).slice(0, chars)).slice(0, 80)
  const start = Math.max(0, index - Math.floor(chars / 3))
  return normalizeForMatch(String(text).slice(start, start + chars)).slice(0, 80)
}

/** 字面量子串搜索：多词按 AND，全部命中才算。任意汉字/单词都能中。 */
function searchIndex(index, rawQuery, options) {
  const query = String(rawQuery ?? '').trim()
  const terms = query.toLowerCase().split(/\s+/u).filter(Boolean)
  if (!terms.length || !index) {
    return { sessions: [], totalHits: 0, sessionsMatched: 0, query }
  }
  const matched = []
  let totalHits = 0
  for (const session of index.sessions.values()) {
    const titleLower = session.titleLower ?? (session.titleLower = String(session.title).toLowerCase())
    let titleMatch = true
    for (const term of terms) {
      if (!titleLower.includes(term)) {
        titleMatch = false
        break
      }
    }
    const hits = []
    let count = 0
    let lastAt = 0
    for (const doc of session.docs) {
      if (options.kinds && !options.kinds.has(doc.kind)) continue
      const lower = lowerOf(doc)
      let ok = true
      for (const term of terms) {
        if (!lower.includes(term)) {
          ok = false
          break
        }
      }
      if (!ok) continue
      count += 1
      if (doc.time > lastAt) lastAt = doc.time
      if (hits.length < options.maxHits) {
        hits.push({
          kind: doc.kind,
          time: doc.time,
          seq: doc.seq ?? null,
          id: doc.id ?? '',
          snippet: snippetFor(doc.text, lower, terms[0], options.snippetChars),
          probe: probeFor(doc.text, lower, terms[0], options.snippetChars),
        })
      }
    }
    if (titleMatch) count += 1
    if (count === 0) continue
    totalHits += count
    matched.push({
      id: session.id,
      title: session.title,
      cwd: session.cwd ?? '',
      titleMatch,
      count,
      lastAt: lastAt || session.lastAt || 0,
      hits,
    })
  }
  matched.sort((left, right) => right.lastAt - left.lastAt)
  return {
    query,
    totalHits,
    sessionsMatched: matched.length,
    sessions: matched.slice(0, options.maxSessions),
  }
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** 收集请求体（纯文本）。 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 浏览器侧自检日志：内存保留最近 50 条，同时落盘（超过 256 KB 只留后半段）。 */
function recordJumpLog(state, paths, body) {
  let entry
  try {
    entry = JSON.parse(body)
  } catch {
    entry = { raw: String(body).slice(0, 500) }
  }
  entry.receivedAt = Date.now()
  state.jumpLog.push(entry)
  if (state.jumpLog.length > 50) state.jumpLog.splice(0, state.jumpLog.length - 50)
  try {
    mkdirSync(paths.cacheDir, { recursive: true })
    const file = join(paths.cacheDir, 'jumps.log')
    let text = ''
    if (existsSync(file)) {
      const buffer = readFileSync(file)
      text = buffer.length > 262144 ? buffer.subarray(buffer.length - 131072).toString('utf8') : buffer.toString('utf8')
      if (text.startsWith('{') === false && text.length > 0) text = ''
    }
    writeFileSync(file, text + JSON.stringify(entry) + '\n')
  } catch {
    /* 日志写失败不影响功能 */
  }
}

/** 宿主半侧：一个内存索引 + 一条 HTTP 路由 + 一个 `record_search` 工具。 */
export function apply(ctx, rawConfig) {
  const cfg = normalizeConfig(rawConfig)
  const paths = resolvePaths(cfg)
  const instance = Math.random().toString(36).slice(2, 8)
  const state = {
    index: null,
    loaded: false,
    building: false,
    buildError: null,
    buildMs: 0,
    lastBuildAt: 0,
    progress: { done: 0, total: 0 },
    stats: { read: 0, reused: 0, failed: 0 },
    failures: [],
    records: 0,
    jumpLog: [],
  }
  let buildPromise = null

  function indexStats() {
    const index = state.index
    let docs = 0
    if (index) for (const session of index.sessions.values()) docs += session.docs.length
    return {
      sessions: index ? index.sessions.size : 0,
      docs,
      builtAt: index ? index.builtAt : 0,
      buildMs: state.buildMs,
      lastBuildAt: state.lastBuildAt,
      stale: state.index ? Date.now() - state.lastBuildAt > cfg.refreshMs : true,
    }
  }

  function loadCache() {
    if (state.loaded) return
    state.loaded = true
    try {
      if (!existsSync(paths.cacheFile)) return
      const parsed = JSON.parse(gunzipSync(readFileSync(paths.cacheFile)).toString('utf8'))
      if (!parsed || parsed.version !== INDEX_VERSION || !Array.isArray(parsed.sessions)) return
      const sessions = new Map()
      for (const entry of parsed.sessions) {
        if (!entry || typeof entry.id !== 'string') continue
        sessions.set(entry.id, {
          id: entry.id,
          title: entry.title ?? '(未命名会话)',
          titleLower: undefined,
          cwd: entry.cwd ?? '',
          lastAt: entry.lastAt ?? 0,
          mtimeMs: entry.mtimeMs ?? 0,
          size: entry.size ?? 0,
          docs: Array.isArray(entry.docs) ? entry.docs.map((d) => ({ kind: d.kind, time: d.time, seq: d.seq, text: d.text, id: d.id ?? '' })) : [],
        })
      }
      state.index = { version: INDEX_VERSION, builtAt: parsed.builtAt ?? 0, sessions }
      state.lastBuildAt = parsed.builtAt ?? 0
    } catch (error) {
      state.buildError = `缓存读取失败：${error instanceof Error ? error.message : String(error)}`
      state.index = null
    }
  }

  function writeCache(index) {
    try {
      mkdirSync(paths.cacheDir, { recursive: true })
      const sessions = []
      for (const session of index.sessions.values()) {
        sessions.push({
          id: session.id,
          title: session.title,
          cwd: session.cwd,
          lastAt: session.lastAt,
          mtimeMs: session.mtimeMs,
          size: session.size,
          docs: session.docs.map((d) => ({ kind: d.kind, time: d.time, seq: d.seq, text: d.text, id: d.id ?? '' })),
        })
      }
      const payload = gzipSync(JSON.stringify({ version: INDEX_VERSION, builtAt: index.builtAt, sessions }), { level: 6 })
      const tmp = paths.cacheFile + '.tmp'
      writeFileSync(tmp, payload)
      renameSync(tmp, paths.cacheFile)
    } catch (error) {
      state.buildError = `缓存写入失败：${error instanceof Error ? error.message : String(error)}`
    }
  }

  /**
   * 增量建索引：mtime+size 未变的会话直接复用旧文档，只读变过的。
   */
  async function build() {
    ensureLoaded()
    const startedAt = Date.now()
    const previous = state.index
    const records = await ctx.sessionQuery.listSessions()
    const files = sessionFileMap(paths.sessionsDir)
    const previousSessions = previous ? previous.sessions : new Map()
    const sessions = new Map()
    const stats = { read: 0, reused: 0, failed: 0 }
    const failures = []
    state.records = records.length
    state.progress = { done: 0, total: records.length }
    await mapLimit(records, 3, async (record) => {
      const id = String(record.header?.id ?? '')
      if (!id) return
      const file = files.get(id) ?? files.get(id.replace(/^session-/, '')) ?? null
      const cached = previousSessions.get(id)
      if (cached && file && cached.mtimeMs === file.mtimeMs && cached.size === file.size && cached.docs.length >= 0) {
        sessions.set(id, cached)
        stats.reused += 1
        state.progress.done += 1
        return
      }
      try {
        const snapshot = await ctx.sessionQuery.readSession(id)
        const built = docsFromSnapshot(snapshot, cfg)
        sessions.set(id, {
          id,
          title: built.title,
          titleLower: undefined,
          cwd: snapshot?.session?.cwd ?? record.header?.cwd ?? '',
          lastAt: built.lastAt,
          mtimeMs: file ? file.mtimeMs : 0,
          size: file ? file.size : 0,
          docs: built.docs,
        })
        stats.read += 1
      } catch (error) {
        stats.failed += 1
        if (failures.length < 12) {
          failures.push({ id, message: error instanceof Error ? error.message : String(error) })
        }
        if (cached) sessions.set(id, cached)
      }
      state.progress.done += 1
    })
    const index = { version: INDEX_VERSION, builtAt: Date.now(), sessions }
    const previousSize = previous ? previous.sessions.size : 0
    if (previousSize > 0 && sessions.size < previousSize && failures.length > 0) {
      // 读取大面积失败时不要用残缺索引覆盖上一份好的
      state.buildError = `本次只读到 ${sessions.size}/${previousSize} 个会话（${failures.length} 个读取失败），已保留上一份索引`
      state.stats = stats
      state.failures = failures
      return previous
    }
    state.index = index
    state.lastBuildAt = index.builtAt
    state.buildMs = Date.now() - startedAt
    state.stats = stats
    state.failures = failures
    state.buildError = null
    writeCache(index)
    return index
  }

  function rebuildInBackground(reason) {
    if (state.building) return buildPromise
    state.building = true
    buildPromise = build()
      .catch((error) => {
        state.buildError = error instanceof Error ? error.message : String(error)
        return null
      })
      .finally(() => {
        state.building = false
        buildPromise = null
        if (reason) state.lastReason = reason
      })
    return buildPromise
  }

  /** 首次搜索前把缓存读进来（懒加载，不拖慢 DSH 启动）。 */
  function ensureLoaded() {
    if (!state.loaded) loadCache()
  }

  async function searchWithFreshness(query, options) {
    ensureLoaded()
    if (!state.index && !state.building) rebuildInBackground('first-search')
    if (state.index && Date.now() - state.lastBuildAt > cfg.refreshMs && !state.building) {
      rebuildInBackground('stale')
    }
    if (!state.index) return { ok: true, indexed: false, building: state.building, status: statusPayload() }
    return { ok: true, indexed: true, ...searchIndex(state.index, query, options ?? cfg), status: statusPayload() }
  }

  function statusPayload() {
    return {
      ok: true,
      instance,
      indexed: state.index !== null,
      building: state.building,
      progress: state.progress,
      records: state.records,
      error: state.buildError,
      failures: state.failures,
      paths: { cache: paths.cacheFile, sessions: paths.sessionsDir },
      stats: state.stats,
      ...indexStats(),
    }
  }

  /** 等到索引可用（工具调用用）：已有索引直接返回，正在建就等，没开始就建。 */
  async function awaitIndex(deadlineMs) {
    ensureLoaded()
    if (state.index) return state.index
    const deadline = Date.now() + deadlineMs
    if (!state.building) rebuildInBackground('tool')
    while (state.building || !state.index) {
      if (Date.now() > deadline) return null
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    return state.index
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler: async (req, res) => {
          try {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1')
            const pathname = url.pathname.replace(/\/+$/u, '')
            if (pathname === ROUTE + '/status') {
              ensureLoaded()
              sendJson(res, 200, statusPayload())
              return
            }
            if (pathname === ROUTE + '/rebuild') {
              ensureLoaded()
              rebuildInBackground('manual')
              sendJson(res, 200, { ok: true, building: true, status: statusPayload() })
              return
            }
            if (pathname === ROUTE + '/log') {
              const body = req.method === 'POST' ? await readBody(req) : (url.searchParams.get('data') ?? '')
              recordJumpLog(state, paths, body)
              sendJson(res, 200, { ok: true, count: state.jumpLog.length })
              return
            }
            if (pathname === ROUTE + '/jumps') {
              sendJson(res, 200, { ok: true, entries: state.jumpLog.slice(-20) })
              return
            }
            if (pathname === ROUTE + '/search' || pathname === ROUTE) {
              const query = url.searchParams.get('q') ?? ''
              const limit = clampInt(url.searchParams.get('limit'), 1, 200, cfg.maxSessions)
              const per = clampInt(url.searchParams.get('per'), 1, 10, cfg.maxHits)
              const kindsParam = url.searchParams.get('kinds')
              const kinds = kindsParam
                ? new Set(kindsParam.split(',').map((value) => value.trim()).filter(Boolean))
                : null
              const options = { ...cfg, maxSessions: limit, maxHits: per, kinds }
              const result = await searchWithFreshness(query, options)
              sendJson(res, 200, result)
              return
            }
            sendJson(res, 404, { ok: false, error: 'unknown route' })
          } catch (error) {
            sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
    'record-search: /record-search route',
  )

  const tool = {
    name: 'record_search',
    description:
      '在全部历史会话正文里做字面量子串搜索（任意一个汉字或词都能命中；英文大小写不敏感；'
      + '空格分隔多个词表示同时包含）。覆盖：用户消息、助手正文、工具输出摘要、会话标题。'
      + '返回命中的会话、每处命中的片段与时间。首次调用若索引未建好会等 60 秒内建完。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要搜的字或词，例如「海关」「1799」「MC-QA」。' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: '最多返回多少个会话，默认 10。' },
        perSession: { type: 'integer', minimum: 1, maximum: 10, description: '每个会话最多几条片段，默认 2。' },
        kinds: {
          type: 'array',
          items: { type: 'string', enum: ['user', 'assistant', 'tool'] },
          description: '只保留这些来源的命中；省略表示全部。',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    timeoutMs: 120000,
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          query: { type: 'string' },
          indexed: { type: 'boolean' },
          sessionsMatched: { type: 'number' },
          totalHits: { type: 'number' },
          tookMs: { type: 'number' },
          index: { type: 'object', additionalProperties: true },
          sessions: { type: 'array', items: { type: 'object', additionalProperties: true } },
          text: { type: 'string' },
          error: { type: 'string' },
        },
        additionalProperties: true,
      },
      render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
    },
    execute: async (args) => {
      const startedAt = Date.now()
      const query = String(args?.query ?? '').trim()
      if (!query) throw new Error('record_search 需要非空的 query')
      const limit = clampInt(args?.limit, 1, 50, 10)
      const perSession = clampInt(args?.perSession, 1, 10, 2)
      const kinds = Array.isArray(args?.kinds) && args.kinds.length ? new Set(args.kinds.map(String)) : null
      const index = await awaitIndex(60000)
      if (!index) {
        return {
          ok: false,
          indexed: false,
          query,
          error: state.buildError ?? '索引仍在构建中，请稍后重试',
          text: `索引还没建好（${state.buildError ?? '仍在构建'}）。再调一次 record_search 即可。`,
        }
      }
      const result = searchIndex(index, query, { ...cfg, maxSessions: limit, maxHits: perSession })
      const sessions = result.sessions
        .map((session) => ({
          ...session,
          hits: kinds ? session.hits.filter((hit) => kinds.has(hit.kind)) : session.hits,
        }))
        .filter((session) => session.hits.length > 0 || session.titleMatch)
      const stats = indexStats()
      const lines = []
      lines.push(
        `「${query}」命中 ${result.sessionsMatched} 个会话 / ${result.totalHits} 处`
          + `（索引 ${stats.sessions} 会话 · ${stats.docs} 条 · 建于 ${new Date(stats.builtAt).toLocaleString('zh-CN')}）`,
      )
      const labels = { user: '我', assistant: '你', tool: '工具' }
      sessions.forEach((session, i) => {
        const where = session.cwd ? basename(session.cwd) : ''
        const when = session.lastAt ? new Date(session.lastAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
        lines.push(`${i + 1}. ${session.title}${where ? ` · ${where}` : ''}${when ? ` · ${when}` : ''} · ${session.count} 处  [${session.id}]`)
        if (session.titleMatch) lines.push('   · 标题命中')
        for (const hit of session.hits) {
          lines.push(`   · ${labels[hit.kind] ?? hit.kind}：${String(hit.snippet).replace(/\s+/gu, ' ')}`)
        }
      })
      if (!sessions.length) lines.push('没有命中。')
      const text = clip(lines.join('\n'), 16000)
      return {
        ok: true,
        indexed: true,
        query,
        sessionsMatched: result.sessionsMatched,
        totalHits: result.totalHits,
        tookMs: Date.now() - startedAt,
        index: { sessions: stats.sessions, docs: stats.docs, builtAt: stats.builtAt, buildMs: stats.buildMs },
        sessions,
        text,
      }
    },
  }

  ctx.effect(() => ctx.tools.register(tool), 'record-search: record_search tool')

  // 后台预热：不阻塞启动，但让第一次搜索/工具调用立刻有结果。
  const timer = setTimeout(() => {
    rebuildInBackground('warmup')
  }, 4000)
  if (typeof timer.unref === 'function') timer.unref()
  ctx.effect(() => () => clearTimeout(timer), 'record-search: warmup timer')

  return () => {
    state.index = null
  }
}
