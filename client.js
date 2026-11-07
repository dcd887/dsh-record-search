/**
 * 会话记录搜索 —— 浏览器半侧。
 *
 * 两个注册点：
 *   - `sidebar.panellist` id `record-search` → 侧栏图标（点开即切到同名 main 面板）
 *   - `main` key `record-search`           → 搜索页：输入即时搜、按会话分组、点标题跳转
 * 数据来自宿主半侧的同源路由 `/record-search/*`，样式只用主题 token。
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-record-search',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PANEL = 'record-search'
    const NS = 'record-search'
    const ENDPOINT = '/record-search'
    /** 客户端版本号：随每次改动递增，用 /record-search/jumps 判断页面跑的是哪一版。 */
    const CLIENT_VERSION = 'jump-5'

    const ZH = {
      title: '会话记录搜索',
      hint: '输一个字或词，实时匹配所有会话正文（你打的字、助手回复、工具输出摘要）；点片段直接跳到那句话',
      jumpTitle: '跳到这条消息',
      placeholder: '输入一个字或词…',
      idle: '输入一个字或词开始搜索。单个汉字也能命中。',
      searching: '搜索中…',
      buildingIndex: '正在建立索引（首次约 10–40 秒，之后只增量更新）…',
      indexLine: '索引 {sessions} 个会话 · {docs} 条记录 · 建于 {built}',
      indexMissing: '索引尚未建立',
      rebuilding: '重建中…',
      rebuild: '重建索引',
      clear: '清空',
      noResults: '没有命中「{query}」。',
      truncated: '只显示最近 {n} 个会话',
      expandAll: '展开全部 {n} 个会话',
      collapse: '收起',
      expandedNote: '已展开全部 {n} 个会话',
      jumpFailed: '没能定位：{reason}（日志已记录）',
      hits: '{n} 处',
      titleHit: '标题命中',
      error: '出错了：{message}',
      retry: '重试',
      kindUser: '我',
      kindAssistant: '你',
      kindTool: '工具',
      filterAll: '全部',
      filterUser: '我的消息',
      filterAssistant: '回复',
      filterTool: '工具输出',
    }
    const EN = {
      title: 'Session record search',
      hint: 'Type a character or word to match every past session; click a snippet to jump to that message.',
      jumpTitle: 'Jump to this message',
      placeholder: 'Type a character or word…',
      idle: 'Type a character or word to search. A single CJK character works.',
      searching: 'Searching…',
      buildingIndex: 'Building the index (about 10–40 s the first time)…',
      indexLine: '{sessions} sessions · {docs} records · built {built}',
      indexMissing: 'Index not built yet',
      rebuilding: 'Rebuilding…',
      rebuild: 'Rebuild index',
      clear: 'Clear',
      noResults: 'No match for “{query}”.',
      truncated: 'Showing the {n} most recent sessions',
      expandAll: 'Show all {n} sessions',
      collapse: 'Collapse',
      expandedNote: 'Showing all {n} sessions',
      jumpFailed: 'Could not jump: {reason} (logged)',
      hits: '{n} hits',
      titleHit: 'title match',
      error: 'Failed: {message}',
      retry: 'Retry',
      kindUser: 'you',
      kindAssistant: 'reply',
      kindTool: 'tool',
      filterAll: 'All',
      filterUser: 'My messages',
      filterAssistant: 'Replies',
      filterTool: 'Tool output',
    }

    const CSS = `
.rs-page{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;height:100%;min-height:0;padding:22px 26px 28px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}
.rs-head{display:flex;flex-direction:column;gap:4px;flex:none}
.rs-title{margin:0;font-size:15px;font-weight:600;line-height:22px}
.rs-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.rs-search{display:flex;align-items:center;gap:8px;flex:none;height:36px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);transition:border-color .15s ease}
.rs-search:focus-within{border-color:var(--dsw-alias-brand-primary)}
.rs-input{flex:1;min-width:0;border:none;outline:none;background:transparent;color:inherit;font:inherit;font-size:14px;line-height:20px}
.rs-input::placeholder{color:var(--dsw-alias-label-secondary);opacity:.75}
.rs-icon-btn{display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;padding:0;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.rs-icon-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.rs-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:none;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.rs-link{padding:0;border:none;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;cursor:pointer;text-decoration:none}
.rs-link:hover{text-decoration:underline}
.rs-chips{display:flex;align-items:center;gap:6px;flex:none;flex-wrap:wrap}
.rs-chip{padding:3px 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.rs-chip:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.rs-chip-on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.rs-foot{display:flex;justify-content:center;flex:none;padding-top:2px}
.rs-more{padding:4px 10px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.rs-more:hover{background:var(--dsw-alias-bg-layer-2)}
.rs-results{display:flex;flex-direction:column;gap:8px;flex:1;min-height:0;overflow-y:auto;padding-right:4px}
.rs-session{border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;flex:none}
.rs-open{display:flex;flex-direction:column;gap:2px;width:100%;padding:9px 12px;border:none;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.rs-open:hover{background:var(--dsw-alias-bg-layer-2)}
.rs-open:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.rs-s-title{font-size:13px;font-weight:500;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rs-s-sub{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rs-hits{display:flex;flex-direction:column;gap:6px;margin:0;padding:0 12px 10px;list-style:none}
.rs-hit{display:flex;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.rs-hit-btn{display:flex;gap:8px;width:100%;margin:0;padding:2px 4px;border:none;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer}
.rs-hit-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.rs-hit-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.rs-kind{flex:none;min-width:24px;color:var(--dsw-alias-label-secondary);opacity:.85}
.rs-snippet{min-width:0;overflow-wrap:anywhere}
.rs-mark{background:transparent;color:var(--dsw-alias-brand-primary);font-weight:600}
.rs-note{display:flex;align-items:center;gap:8px;padding:14px 12px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.rs-error{color:var(--dsw-alias-state-error-primary)}
.rs-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary);animation:rs-pulse 1.2s ease-in-out infinite}
@keyframes rs-pulse{0%,100%{opacity:.25}50%{opacity:1}}
`

    let styleElement = null
    function installStyles() {
      if (typeof document === 'undefined') return () => {}
      styleElement = document.createElement('style')
      styleElement.setAttribute('data-record-search', '')
      styleElement.textContent = CSS
      document.head.appendChild(styleElement)
      return () => {
        if (styleElement && styleElement.parentNode) styleElement.parentNode.removeChild(styleElement)
        styleElement = null
      }
    }

    function escapeRegExp(text) {
      return String(text).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    }

    function formatTime(ts) {
      if (!ts) return ''
      try {
        return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      } catch {
        return ''
      }
    }

    function highlight(text, query) {
      const terms = String(query || '').trim().split(/\s+/u).filter(Boolean).map(escapeRegExp)
      const source = String(text ?? '')
      if (!terms.length) return source
      const parts = source.split(new RegExp('(' + terms.join('|') + ')', 'giu'))
      return parts.map((part, index) => (index % 2 === 1 ? h('mark', { key: index, className: 'rs-mark' }, part) : part))
    }

    async function getJson(path, signal) {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal })
      if (response.ok !== true) throw new Error('HTTP ' + String(response.status))
      return response.json()
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const CHAT_ROW = '[data-chat-flow-key]'

    /** 只留字母/数字/汉字，和服务端 probe 用同一套归一化。 */
    function normalizeText(text) {
      return String(text || '').replace(/[^\p{L}\p{N}]+/gu, '')
    }

    /** 淡入一次的定位高亮：改了内联样式，1.8 秒后还原。 */
    function flashRow(row) {
      const target = row.firstElementChild || row
      const previousShadow = target.style.boxShadow
      const previousRadius = target.style.borderRadius
      target.style.transition = 'box-shadow .18s ease'
      target.style.borderRadius = '8px'
      target.style.boxShadow = '0 0 0 2px var(--dsw-alias-brand-primary)'
      setTimeout(() => {
        target.style.transition = ''
        target.style.boxShadow = previousShadow
        target.style.borderRadius = previousRadius
      }, 1800)
    }

    /** 会话行是否真的可见（折叠成员高度为 0，scrollIntoView 对它是无效的）。 */
    function isRowVisible(row) {
      if (!row || typeof row.getBoundingClientRect !== 'function') return false
      const rect = row.getBoundingClientRect()
      return rect.height > 0 && rect.bottom > 0 && rect.top < (window.innerHeight || document.documentElement.clientHeight)
    }

    /** 行是否被折叠成 0 高（这种才需要先展开；「在视口外」不需要）。 */
    function isRowCollapsed(row) {
      if (!row || typeof row.getBoundingClientRect !== 'function') return true
      return row.getBoundingClientRect().height === 0
    }

    /**
     * 把隐藏的行变可见：从行本身往上逐层收集 `button[aria-expanded="false"]`，
     * 一个一个点，每点一个就验一次可见性，第一个生效就停。
     * （宿主把工具/思考收进 turn-process 折叠组，开关层级不固定，所以用「点一个验一个」而不是猜选择器。）
     * @returns 已点击的层数（0 = 没找到任何可点开关）
     */
    async function revealRow(row, hit) {
      const candidates = []
      let node = row
      let guard = 0
      while (node && guard++ < 8) {
        const button = typeof node.querySelector === 'function'
          ? node.querySelector('button[aria-expanded="false"]')
          : null
        if (button && candidates.indexOf(button) === -1) candidates.push(button)
        node = node.parentElement
      }
      let clicked = 0
      let current = row
      for (const button of candidates.slice(0, 4)) {
        try {
          button.click()
        } catch {
          continue
        }
        clicked += 1
        await sleep(240)
        const fresh = (await findRow(hit, 800)) || current
        current = fresh
        // 不再被折叠就交给滚动处理（别为「在视口外」多点开关）
        if (!isRowCollapsed(current)) return { clicked, row: current }
      }
      return { clicked, row: current }
    }

    /** 祖先链快照：定位失败时看是哪一层把行藏起来了（只读，不改 DOM）。 */
    function describeChain(row) {
      const chain = []
      let node = row
      let guard = 0
      while (node && guard++ < 7) {
        chain.push({
          tag: node.tagName,
          cls: String(node.className || '').slice(0, 48),
          hidden: node.hasAttribute('hidden') || undefined,
          kind: node.getAttribute('data-chat-flow-kind') || undefined,
          member: node.getAttribute('data-turn-process-member') || undefined,
          tpHidden: node.getAttribute('data-turn-process-hidden') || undefined,
          toggles: Array.from(node.querySelectorAll('button[aria-expanded]'))
            .slice(0, 3)
            .map((button) => button.getAttribute('aria-expanded')),
        })
        node = node.parentElement
      }
      return chain
    }

    /**
     * 在会话 DOM 里找一条已渲染的 Chat 行。
     * 先按节点 key 精确匹配（user 节点 key 形如 `4:user<messageId>`），
     * 退化到文字探针（渲染后 markdown 符号会消失，所以两边都做归一化）。
     */
    async function findRow(hit, timeoutMs) {
      const probe = String(hit && hit.probe ? hit.probe : '')
      const id = String(hit && hit.id ? hit.id : '')
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const rows = Array.from(document.querySelectorAll(CHAT_ROW))
        if (id) {
          const byKey = rows.find((row) => {
            const key = row.getAttribute('data-chat-node-key') || row.getAttribute('data-chat-flow-key') || ''
            return key.includes(id)
          })
          if (byKey) return byKey
        }
        if (probe.length >= 8) {
          const byText = rows.find((row) => normalizeText(row.textContent).includes(probe))
          if (byText) return byText
        }
        if (Date.now() > deadline) {
          const short = probe.slice(0, 12)
          if (short.length >= 6) {
            const loose = rows.find((row) => normalizeText(row.textContent).includes(short))
            if (loose) return loose
          }
          return null
        }
        await sleep(120)
      }
    }

    function Magnifier({ size }) {
      return h(
        'svg',
        {
          width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
          stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
          'aria-hidden': true, style: { display: 'block' },
        },
        h('circle', { cx: 11, cy: 11, r: 6.5 }),
        h('path', { d: 'M16 16l4 4' }),
      )
    }

    function PanelIcon({ size }) {
      return h(Magnifier, { size: size ?? 16 })
    }

    /**
     * 面板组件。ctx 在 apply 里被闭包捕获（组件里拿不到 ctx）。
     * @param ctx - Client root context。
     */
    function createPanel(ctx) {
      function trFrom(props) {
        const raw = props && props.t
        return (key, vars) => {
          let value = typeof raw === 'function' ? raw(key) : undefined
          if (typeof value !== 'string' || value === key) value = ZH[key] ?? key
          return typeof vars === 'object' && vars ? value.replace(/\{(\w+)\}/gu, (m, name) => String(vars[name] ?? m)) : value
        }
      }

      function openSession(sessionId) {
        const ui = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
        if (ui && typeof ui.openSession === 'function') {
          ui.openSession(sessionId)
          return true
        }
        return false
      }

      /** 会话选择状态（uiWorkspace 的持久化 store），用来确认"真的切过去了"。 */
      function readSelection() {
        const ui = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
        const store = ui && ui.selection
        if (store && typeof store.getSnapshot === 'function') {
          const snapshot = store.getSnapshot()
          if (snapshot && snapshot.sessionId) return String(snapshot.sessionId)
        }
        return null
      }

      async function waitForSelection(sessionId, timeoutMs) {
        const deadline = Date.now() + timeoutMs
        let sawSelection = false
        for (;;) {
          const current = readSelection()
          if (current !== null) sawSelection = true
          if (current === sessionId) return 'matched'
          if (Date.now() > deadline) return sawSelection ? 'mismatch' : 'unknown'
          await sleep(120)
        }
      }

      function sendReport(report) {
        try {
          fetch(ENDPOINT + '/log', {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            body: JSON.stringify(report),
          }).catch(() => {})
        } catch {
          /* 日志不重要 */
        }
      }

      /**
       * 打开会话并定位到某一条消息：
       * 1) openSession 切过去，并**确认选择真的变了**（否则别把用户丢在错误会话里）
       * 2) `loadThrough(seq)` 把目标事件拉进已加载窗口（否则旧消息不在 DOM 里）
       * 3) 在 DOM 里按节点 key / 文字探针找到那一行，滚动到中央 + 高亮一下
       * @returns {Promise<{ok:boolean, reason?:string}>}
       */
      async function jumpToHit(sessionId, hit) {
        const startedAt = Date.now()
        const report = {
          version: CLIENT_VERSION,
          at: startedAt,
          sessionId,
          seq: hit && hit.seq,
          id: hit && hit.id,
          selectionBefore: readSelection(),
          steps: [],
        }
        const step = (name, extra) => report.steps.push({ name, ms: Date.now() - startedAt, ...(extra || {}) })
        try {
          const ui = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
          if (!ui || typeof ui.openSession !== 'function') {
            step('no-uiWorkspace')
            return { ok: false, reason: 'no-uiWorkspace' }
          }
          ui.openSession(sessionId)
          step('opened')
          const switchState = await waitForSelection(sessionId, 2500)
          step('switch', { state: switchState, selection: readSelection() })
          if (switchState === 'mismatch') return { ok: false, reason: 'selection-not-changed' }

          const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
          if (sessions && hit && hit.seq) {
            try {
              await Promise.race([
                sessions.using(sessionId, { source: 'gateway' }, (reference) =>
                  reference.binding.session.loadThrough(hit.seq),
                ),
                sleep(6000),
              ])
              step('loadThrough', { ok: true })
            } catch (error) {
              step('loadThrough', { ok: false, error: String(error && error.message ? error.message : error) })
            }
          }

          const found = await findRow(hit, 3500)
          const rows = Array.from(document.querySelectorAll(CHAT_ROW))
          step('find', {
            found: Boolean(found),
            rows: rows.length,
            key: found ? found.getAttribute('data-chat-node-key') : null,
            collapsed: isRowCollapsed(found),
            // 只在没找到时留现场的样例行，避免每次点击都写一截会话正文进日志
            sample: found
              ? undefined
              : rows.slice(0, 6).map((item) => ({
                  key: item.getAttribute('data-chat-node-key'),
                  turn: item.getAttribute('data-chat-turn'),
                  text: String(item.textContent || '').slice(0, 40),
                })),
          })
          if (!found) return { ok: false, reason: 'row-not-found' }

          // 折叠组里的行高度为 0，scrollIntoView 对它是无效的：先点开关把它露出来
          let row = found
          if (isRowCollapsed(row)) {
            const revealed = await revealRow(row, hit)
            row = revealed.row
            step('reveal', { clicked: revealed.clicked, collapsed: isRowCollapsed(row) })
            if (isRowCollapsed(row)) step('chain', { chain: describeChain(found) })
          }

          try {
            row.scrollIntoView({ block: 'center', behavior: 'smooth' })
          } catch {
            try {
              row.scrollIntoView()
            } catch {
              /* 老浏览器忽略 */
            }
          }
          await sleep(260)
          if (!isRowVisible(row)) {
            try {
              row.scrollIntoView({ block: 'center' })
            } catch {
              /* 忽略 */
            }
            await sleep(160)
          }
          flashRow(row)
          step('scrolled', { visible: isRowVisible(row) })
          return { ok: isRowVisible(row) }
        } finally {
          sendReport(report)
        }
      }

      return function RecordSearchPanel(props) {
        const t = trFrom(props)
        const [query, setQuery] = React.useState('')
        const [kind, setKind] = React.useState('all')
        const [expanded, setExpanded] = React.useState(false)
        const [result, setResult] = React.useState({ phase: 'idle', data: null, error: null })
        const [status, setStatus] = React.useState(null)
        const [note, setNote] = React.useState(null)
        const inputRef = React.useRef(null)

        React.useEffect(() => {
          if (inputRef.current && typeof inputRef.current.focus === 'function') inputRef.current.focus()
        }, [])

        React.useEffect(() => {
          let cancelled = false
          sendReport({ version: CLIENT_VERSION, event: 'mount', at: Date.now() })
          getJson(ENDPOINT + '/status')
            .then((value) => { if (!cancelled) setStatus(value) })
            .catch(() => {})
          return () => { cancelled = true }
        }, [])

        React.useEffect(() => {
          const trimmed = query.trim()
          if (!trimmed) {
            setResult({ phase: 'idle', data: null, error: null })
            return undefined
          }
          let cancelled = false
          let pollTimer = null
          const controller = new AbortController()
          const run = async () => {
            try {
              setResult((previous) => ({
                phase: previous.data ? 'refreshing' : 'loading',
                data: previous.data,
                error: null,
              }))
              const value = await getJson(
                ENDPOINT + '/search?q=' + encodeURIComponent(trimmed)
                  + (kind === 'all' ? '' : '&kinds=' + kind)
                  + (expanded ? '&limit=200&per=10' : ''),
                controller.signal,
              )
              if (cancelled) return
              if (value.indexed === false) {
                setResult({ phase: 'building', data: null, error: null })
                if (value.status) setStatus(value.status)
                pollTimer = setTimeout(run, 800)
                return
              }
              if (value.status) setStatus(value.status)
              setResult({ phase: 'ready', data: value, error: null })
            } catch (error) {
              if (cancelled || controller.signal.aborted) return
              const message = error && error.message ? error.message : String(error)
              setResult((previous) => ({ phase: 'error', data: previous.data, error: message }))
            }
          }
          const debounce = setTimeout(run, 160)
          return () => {
            cancelled = true
            clearTimeout(debounce)
            if (pollTimer) clearTimeout(pollTimer)
            controller.abort()
          }
        }, [query, kind, expanded])

        const rebuild = () => {
          getJson(ENDPOINT + '/rebuild')
            .then((value) => { if (value && value.status) setStatus(value.status) })
            .catch(() => {})
        }

        const data = result.data
        const sessions = data && Array.isArray(data.sessions) ? data.sessions : []
        const kinds = { user: t('kindUser'), assistant: t('kindAssistant'), tool: t('kindTool') }

        const statusParts = []
        if (status) {
          if (status.indexed) {
            statusParts.push(t('indexLine', {
              sessions: status.sessions ?? 0,
              docs: status.docs ?? 0,
              built: formatTime(status.builtAt) || '—',
            }))
          } else {
            statusParts.push(t('indexMissing'))
          }
        }
        if (data && data.indexed) {
          if (data.sessionsMatched > 0) statusParts.push(t('hits', { n: data.totalHits ?? 0 }) + ' · ' + (data.sessionsMatched ?? 0))
        }

        let body
        if (result.phase === 'idle') {
          body = h('div', { className: 'rs-note' }, t('idle'))
        } else if (result.phase === 'building') {
          body = h('div', { className: 'rs-note' }, h('span', { className: 'rs-dot' }), t('buildingIndex'))
        } else if (result.phase === 'error') {
          body = h('div', { className: 'rs-note rs-error' }, t('error', { message: result.error }))
        } else if (result.phase === 'loading' && !data) {
          body = h('div', { className: 'rs-note' }, h('span', { className: 'rs-dot' }), t('searching'))
        } else if (sessions.length === 0) {
          body = h('div', { className: 'rs-note' }, t('noResults', { query: data ? data.query : query }))
        } else {
          body = h(
            'div',
            { className: 'rs-results' },
            sessions.map((session) => {
              const where = session.cwd ? String(session.cwd).split(/[\\/]/u).filter(Boolean).pop() : ''
              const meta = [where, formatTime(session.lastAt), t('hits', { n: session.count })].filter(Boolean).join(' · ')
              return h(
                'div',
                { key: session.id, className: 'rs-session' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'rs-open',
                    title: session.id,
                    onClick: () => { openSession(session.id) },
                  },
                  h('span', { className: 'rs-s-title' }, session.title),
                  h('span', { className: 'rs-s-sub' }, session.titleMatch ? meta + ' · ' + t('titleHit') : meta),
                ),
                Array.isArray(session.hits) && session.hits.length > 0
                  ? h(
                      'ul',
                      { className: 'rs-hits' },
                      session.hits.map((hit, index) =>
                        h(
                          'li',
                          { key: index, className: 'rs-hit' },
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'rs-hit-btn',
                              title: t('jumpTitle'),
                              onClick: () => {
                                setNote(null)
                                jumpToHit(session.id, hit).then((outcome) => {
                                  if (!outcome || outcome.ok !== true) setNote((outcome && outcome.reason) || 'unknown')
                                })
                              },
                            },
                            h('span', { className: 'rs-kind' }, kinds[hit.kind] ?? hit.kind),
                            h('span', { className: 'rs-snippet' }, highlight(hit.snippet, query)),
                          ),
                        ),
                      ),
                    )
                  : null,
              )
            }),
            data && data.sessionsMatched > sessions.length
              ? h('div', { className: 'rs-note' }, t('truncated', { n: sessions.length }))
              : null,
          )
        }

        const canExpand = Boolean(data && data.sessionsMatched > sessions.length)
        const foot =
          canExpand
            ? h(
                'button',
                { type: 'button', className: 'rs-more', onClick: () => setExpanded(true) },
                t('expandAll', { n: data.sessionsMatched }),
              )
            : expanded && data && data.sessionsMatched > 0
              ? h(
                  'button',
                  { type: 'button', className: 'rs-more', onClick: () => setExpanded(false) },
                  t('collapse') + ' · ' + t('expandedNote', { n: data.sessionsMatched }),
                )
              : null

        return h(
          'div',
          { className: 'rs-page' },
          h(
            'div',
            { className: 'rs-head' },
            h('h1', { className: 'rs-title' }, t('title')),
            h('p', { className: 'rs-hint' }, t('hint')),
          ),
          h(
            'div',
            { className: 'rs-search' },
            h(Magnifier, { size: 14 }),
            h('input', {
              ref: inputRef,
              className: 'rs-input',
              type: 'text',
              value: query,
              placeholder: t('placeholder'),
              onChange: (event) => {
                setQuery(event.target.value)
                if (expanded) setExpanded(false)
              },
              onKeyDown: (event) => {
                if (event.key === 'Escape') {
                  setQuery('')
                  setExpanded(false)
                }
              },
            }),
            query
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'rs-icon-btn',
                    'aria-label': t('clear'),
                    title: t('clear'),
                    onClick: () => setQuery(''),
                  },
                  h('svg', {
                    width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none',
                    stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round',
                    'aria-hidden': true,
                  }, h('path', { d: 'M6 6l12 12M18 6L6 18' })),
                )
              : null,
          ),
          h(
            'div',
            { className: 'rs-chips' },
            [
              ['all', t('filterAll')],
              ['user', t('filterUser')],
              ['assistant', t('filterAssistant')],
              ['tool', t('filterTool')],
            ].map(([value, label]) =>
              h(
                'button',
                {
                  key: value,
                  type: 'button',
                  className: 'rs-chip' + (kind === value ? ' rs-chip-on' : ''),
                  onClick: () => setKind(value),
                },
                label,
              ),
            ),
          ),
          h(
            'div',
            { className: 'rs-meta' },
            h('span', null, statusParts.join(' · ')),
            status && status.building ? h('span', { className: 'rs-dot' }) : null,
            status && status.building ? h('span', null, t('rebuilding')) : null,
            h(
              'button',
              { type: 'button', className: 'rs-link', onClick: rebuild, disabled: Boolean(status && status.building) },
              t('rebuild'),
            ),
          ),
          body,
          note ? h('div', { className: 'rs-note rs-error' }, t('jumpFailed', { reason: note })) : null,
          foot ? h('div', { className: 'rs-foot' }, foot) : null,
        )
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const locale = ctx.get('locale')
        if (locale && typeof locale.register === 'function') {
          ctx.effect(() => locale.register(NS, 'zh', ZH), 'record-search: locale zh')
          ctx.effect(() => locale.register(NS, 'en', EN), 'record-search: locale en')
        }
        ctx.effect(() => installStyles(), 'record-search: styles')
        const Panel = createPanel(ctx)
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL, locale: NS }, Panel),
        )
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL,
              order: 40,
              label: () => {
                const active = ctx.get('locale')
                if (active && typeof active.bind === 'function') {
                  try {
                    return active.bind(NS)('title')
                  } catch {
                    return ZH.title
                  }
                }
                return ZH.title
              },
            },
            PanelIcon,
          ),
        )
      },
    }
  },
})
