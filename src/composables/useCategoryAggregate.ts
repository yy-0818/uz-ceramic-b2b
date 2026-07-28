// src/composables/useCategoryAggregate.ts
// 库存导入预览用的"两层归纳"：分类 → 色号前缀
// - colorPrefix：色号前缀（A1/A2/... → A，D1/D2 → D）
// - aggregate：ProductCandidate[] → 按 category + colorPrefix 二级汇总

import type { ProductCandidate } from './useInventoryCsv'

export type PrefixAgg = {
  prefix: string
  boxes: number
  models: number
  colors: Array<{ code: string; boxes: number }>
}

export type CategoryAgg = {
  category: string
  totalBoxes: number
  totalL1: number
  totalL2: number
  models: number
  prefixes: PrefixAgg[]
  products: ProductCandidate[]
}

export function colorPrefix(code: string): string {
  // D1..D22 → D, A1..A14 → A, A → A, 其它 → 首字母
  const m = code.match(/^([A-Z])/i)
  return m ? m[1].toUpperCase() : '#'
}

export function aggregate(items: ProductCandidate[]): CategoryAgg[] {
  const catMap = new Map<string, CategoryAgg>()
  for (const p of items) {
    let agg = catMap.get(p.category)
    if (!agg) {
      agg = {
        category: p.category,
        totalBoxes: 0,
        totalL1: 0,
        totalL2: 0,
        models: 0,
        prefixes: [],
        products: [],
      }
      catMap.set(p.category, agg)
    }
    agg.totalBoxes += p.totalLevel1 + p.totalLevel2
    agg.totalL1 += p.totalLevel1
    agg.totalL2 += p.totalLevel2
    agg.models += 1
    agg.products.push(p)

    const prefMap = new Map<string, PrefixAgg>()
    for (const c of p.colors) {
      const pref = colorPrefix(c.colorCode)
      let pa = prefMap.get(pref)
      if (!pa) {
        pa = { prefix: pref, boxes: 0, models: 0, colors: [] }
        prefMap.set(pref, pa)
      }
      pa.boxes += c.boxes
      const exists = pa.colors.find((x) => x.code === c.colorCode)
      if (exists) exists.boxes += c.boxes
      else pa.colors.push({ code: c.colorCode, boxes: c.boxes })
    }
    for (const [pref, pa] of prefMap) {
      let exist = agg.prefixes.find((x) => x.prefix === pref)
      if (exist) {
        exist.boxes += pa.boxes
        for (const cc of pa.colors) {
          const e = exist.colors.find((x) => x.code === cc.code)
          if (e) e.boxes += cc.boxes
          else exist.colors.push(cc)
        }
      } else {
        agg.prefixes.push(pa)
      }
    }
  }
  for (const a of catMap.values()) {
    a.prefixes.sort((x, y) => x.prefix.localeCompare(y.prefix))
    a.prefixes.forEach((pf) => pf.colors.sort((x, y) => x.code.localeCompare(y.code)))
  }
  return Array.from(catMap.values()).sort((a, b) => a.category.localeCompare(b.category))
}