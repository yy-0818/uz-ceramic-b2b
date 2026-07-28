import { describe, it, expect } from 'vitest'
import { parseExcelRow } from '@/composables/useAccounts'

describe('parseExcelRow', () => {
  it('parses a valid public account row (using Chinese column names)', () => {
    const row = parseExcelRow({
      '类别': '一类',
      '税号': '1234567',
      '客户名称': 'ACME LLC',
      '账户类型': '1账户',
      '状态': '可用',
    })
    expect(row).toEqual({
      category: '一类',
      inn: '1234567',
      name: 'ACME LLC',
      type: '1_public',
      status: 'active',
    })
  })

  it('accepts legacy English column names', () => {
    const row = parseExcelRow({
      category: '1cat',
      inn: '-',
      name: 'Beta',
      type: '2账户',
      status: 'available',
    })
    expect(row).toEqual({
      category: '1cat',
      inn: '', // '-' stripped
      name: 'Beta',
      type: '2_cash',
      status: 'active',
    })
  })

  it('returns null when category or name is empty', () => {
    expect(parseExcelRow({ '类别': '', '客户名称': 'X', '账户类型': '1账户' })).toBeNull()
    expect(parseExcelRow({ '类别': 'C', '客户名称': '', '账户类型': '1账户' })).toBeNull()
  })

  it('returns null on unrecognized 账户类型', () => {
    expect(parseExcelRow({ '类别': 'C', '客户名称': 'X', '账户类型': '99账户' })).toBeNull()
  })

  it('maps 状态 停用 to inactive', () => {
    const row = parseExcelRow({
      '类别': 'C', '客户名称': 'X', '账户类型': '1账户', '状态': '停用',
    })
    expect(row?.status).toBe('inactive')
  })

  it('defaults 状态 to active when missing', () => {
    const row = parseExcelRow({
      '类别': 'C', '客户名称': 'X', '账户类型': '1账户',
    })
    expect(row?.status).toBe('active')
  })

  it('strips 0 / - / empty inn to empty string', () => {
    for (const inn of ['0', '-', '']) {
      const row = parseExcelRow({ '类别': 'C', '客户名称': 'X', '账户类型': '1账户', '税号': inn })
      expect(row?.inn).toBe('')
    }
  })
})
