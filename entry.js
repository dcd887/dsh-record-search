/**
 * 会话记录搜索 —— 宿主半侧入口（`exports["."]`）。
 *
 * 这一层刻意保持极薄：Harness 把一个包的入口模块按 URL 钉死在进程里，改入口文件不会热更新；
 * 所以真正的实现放在 impl.js，用「文件 mtime 作为查询串」的动态 import 加载，
 * 每次激活都跑最新实现，改 impl.js 不用重启 DSH。
 */
import { statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const IMPL_FILE = path.join(HERE, 'impl.js')

export const name = 'record-search'
export const inject = ['webServer', 'sessionQuery', 'tools']

/** 宽松校验：已知字段在 impl.js 里兜默认值，未知字段直接透传（升级后旧校验不会拒绝新键）。 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'record-search',
    validate: (value) => {
      if (value === undefined || value === null) return { value: {} }
      if (typeof value !== 'object' || Array.isArray(value)) {
        return { issues: [{ message: 'config must be an object', path: [] }] }
      }
      return { value: { ...value } }
    },
  },
}

let cached = null

function loadImplementation() {
  const revision = String(statSync(IMPL_FILE).mtimeMs)
  if (cached !== null && cached.revision === revision) return cached.promise
  const url = pathToFileURL(IMPL_FILE).href + '?rev=' + revision
  const promise = import(url).catch((error) => {
    cached = null
    throw error
  })
  cached = { revision, promise }
  return promise
}

export async function apply(ctx, config) {
  const implementation = await loadImplementation()
  return implementation.apply(ctx, config)
}
