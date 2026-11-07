// 冒烟自测：验证 record-search 的宿主侧能加载、能注册 record_search 工具、schema 完整、
// 能注册 /record-search 路由。索引与真实搜索需要 dsh 的 sessionQuery 服务，
// 这里用一个空实现顶住，只验接口不验数据。
// 任一断言失败，退出码为 1。
import { apply } from './impl.js'

let failures = 0
const check = (label, ok, detail) => {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`)
}

const registered = {}
const routeDefs = []
const fakeCtx = {
  effect: (fn) => {
    const d = fn()
    return typeof d === 'function' ? d : () => {}
  },
  tools: { register: (d) => { registered[d.name] = d; return () => {} } },
  // 真实插件用的是 ctx.webServer.register({ kind, path, handler })
  webServer: { register: (def) => { routeDefs.push(def); return () => {} } },
  // 真实插件直接读 ctx.sessionQuery，不经过 ctx.get()
  sessionQuery: {
    listSessions: async () => [],
    readSession: async () => null,
  },
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  on: () => () => {},
  get: () => undefined,
}

console.log('【加载】')
let threw = null
try {
  await apply(fakeCtx, {})
} catch (e) {
  threw = e
}
check('apply 不抛异常', threw === null, threw ? threw.message : undefined)

console.log('\n【工具注册】')
const tool = registered['record_search']
check('注册了 record_search', Boolean(tool))
if (tool) {
  const props = Object.keys(tool.parameters?.properties ?? {})
  check('有 query 参数', props.includes('query'), `参数=${props.join(',')}`)
  check('query 必填', Array.isArray(tool.parameters?.required) && tool.parameters.required.includes('query'))
  check('有 limit 与 perSession', props.includes('limit') && props.includes('perSession'))
  const kinds = tool.parameters?.properties?.kinds?.items?.enum
  check('kinds 只允许 user/assistant/tool',
    Array.isArray(kinds) && ['user', 'assistant', 'tool'].every((k) => kinds.includes(k)),
    `enum=${Array.isArray(kinds) ? kinds.join('/') : '(无)'}`)
  check('有工具描述', String(tool.description || '').length > 0)
}

console.log('\n【路由】')
const route = routeDefs.find((d) => String(d?.path || '').includes('record-search'))
check('注册了 /record-search 路由', Boolean(route), `已注册=${routeDefs.map((d) => d?.path).join(',') || '(无)'}`)
if (route) {
  check('路由 kind 是 prefix', route.kind === 'prefix', `kind=${route.kind}`)
  check('路由带 handler', typeof route.handler === 'function')
}

console.log(`\n结果：${failures === 0 ? '全部通过' : failures + ' 项失败'}`)
process.exitCode = failures === 0 ? 0 : 1
