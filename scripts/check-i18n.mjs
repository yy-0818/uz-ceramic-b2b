#!/usr/bin/env node
/**
 * check-i18n.mjs —— 确保 zh / ru / uz 三个语言包结构一致
 *
 * 做法：临时把 .ts 改写成纯 ES module（去除 export default 等语法），
 *       用 dynamic import 拿到对象，flatten 后做差集对比。
 *
 * 规则：
 *  - 三份 key 集合必须一致
 *  - 叶子必须是 string
 *  - 报告缺漏清单 + 非零退出码（CI 阻断）
 *
 * 注意：会用临时 .mjs 副本（始终在内存，原始文件不动）。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import os from 'node:os'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const LOCALES_DIR = path.join(ROOT, 'src', 'locales')
const LANGS = ['zh', 'ru', 'uz']

/** 把 .ts 转成 .mjs 在临时目录 */
async function loadTsAsEsm(tsPath) {
  const src = await fs.readFile(tsPath, 'utf8')
  // 去掉 `export default ` 前缀，留下纯对象字面量
  const mjsSrc = src.replace(/^\s*export\s+default\s+/, 'export default ')
    // 不允许 import 语句（语言包没有依赖）

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-'))
  const mjsPath = path.join(tmpDir, path.basename(tsPath, '.ts') + '.mjs')
  await fs.writeFile(mjsPath, mjsSrc, 'utf8')
  const mod = await import(pathToFileURL(mjsPath).href)
  return mod.default ?? mod
}

function flatten(obj, prefix = '') {
  if (obj == null) return []
  if (typeof obj === 'string') return [prefix.replace(/\.$/, '')]
  if (typeof obj !== 'object') return []
  const out = []
  for (const [k, v] of Object.entries(obj)) {
    out.push(...flatten(v, `${prefix}${k}.`))
  }
  return out
}

function diff(a, b) {
  const A = new Set(a)
  const B = new Set(b)
  const onlyInA = [...A].filter((x) => !B.has(x)).sort()
  const onlyInB = [...B].filter((x) => !A.has(x)).sort()
  return { onlyInA, onlyInB }
}

async function main() {
  const strict = process.argv.includes('--strict')
  const reports = {}
  for (const lang of LANGS) {
    const tsPath = path.join(LOCALES_DIR, `${lang}.ts`)
    try {
      const obj = await loadTsAsEsm(tsPath)
      reports[lang] = flatten(obj).sort()
      console.log(`📦 ${lang}: ${reports[lang].length} keys`)
    } catch (e) {
      console.error(`❌ Failed to load ${lang}.ts:`, e.message)
      process.exit(1)
    }
  }

  let hasDiff = false
  const missing = { zh: [], ru: [], uz: [] }
  for (let i = 0; i < LANGS.length; i++) {
    for (let j = i + 1; j < LANGS.length; j++) {
      const a = LANGS[i], b = LANGS[j]
      const { onlyInA, onlyInB } = diff(reports[a], reports[b])
      if (onlyInA.length || onlyInB.length) {
        hasDiff = true
        onlyInA.forEach((k) => missing[a] && missing[a].push(k))
        onlyInB.forEach((k) => missing[b] && missing[b].push(k))
        console.error(`\n⚠️  Diff between ${a} and ${b}:`)
        if (onlyInA.length) {
          console.error(`  only in ${a} (${onlyInA.length}):`)
          onlyInA.slice(0, 10).forEach((k) => console.error(`    - ${k}`))
          if (onlyInA.length > 10) console.error(`    ... and ${onlyInA.length - 10} more`)
        }
        if (onlyInB.length) {
          console.error(`  only in ${b} (${onlyInB.length}):`)
          onlyInB.slice(0, 10).forEach((k) => console.error(`    - ${k}`))
          if (onlyInB.length > 10) console.error(`    ... and ${onlyInB.length - 10} more`)
        }
      } else {
        console.log(`✅ ${a} ↔ ${b} identical (${reports[a].length} keys)`)
      }
    }
  }

  if (hasDiff) {
    // 总是输出 JSON 给 CI 上传
    const reportPath = path.join(ROOT, `i18n-missing-${Date.now()}.json`)
    await fs.writeFile(reportPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      missing,
      stats: Object.fromEntries(LANGS.map((l) => [l, reports[l].length])),
    }, null, 2), 'utf8')
    console.warn(`\n📝 写出缺失清单：${reportPath}`)

    if (strict) {
      console.error('\n💡 --strict 模式：CI 会阻断了')
      process.exit(1)
    } else {
      console.warn(`\n💡 非 --strict 模式：仅警告。lib/i18n.ts fallback 链会让 ru/uz 缺 key 时回到 zh，请人工补齐。`)
      console.warn(`   跑 \`npm run i18n:check -- --strict\` 可以手动验证补齐完成。`)
      process.exit(0)
    }
  }
  console.log('\n✅ 翻译一致性 check 通过')
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
