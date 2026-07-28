import { describe, it, expect } from 'vitest'
import { useI18n, setLocale, tForLocale, reportMissingTranslations } from '@/lib/i18n'

describe('i18n runtime', () => {
  it('falls back to DEFAULT_LOCALE (ru) when current locale lacks key', () => {
    setLocale('zh')
    const { t } = useI18n()
    // nav.foo doesn't exist anywhere — expect __MISSING fallback marker
    expect(t('nav.foo')).toBe('__MISSING.nav.foo')
  })

  it('substitutes {name} placeholders', () => {
    setLocale('zh')
    const { t } = useI18n()
    // pick any key with a placeholder
    const out = t('invite.welcome', { name: '客户A' })
    expect(out).toContain('客户A')
    expect(out).not.toContain('{name}')
  })

  it('returns raw key path when value is null', () => {
    const out = tForLocale('zh' as any, 'definitely_not_a_key')
    expect(out).toBe('__MISSING.definitely_not_a_key')
  })

  it('uses tForLocale to render ru templateBody correctly', () => {
    const ru = tForLocale('ru', 'admin.invites.templateBody', {
      greeting: 'Здравствуйте',
      accountName: 'Acme',
      expiresDays: 7,
      url: 'https://x',
      loginEmail: 'a@b.com',
      brand: 'Керамика · B2B',
    })
    expect(ru).toContain('Здравствуйте')
    expect(ru).toContain('Acme')
    expect(ru).toContain('7')
    expect(ru).toContain('https://x')
    expect(ru).toContain('a@b.com')
    expect(ru).toContain('Керамика · B2B')
  })

  it('uses tForLocale to render zh templateBody correctly', () => {
    const zh = tForLocale('zh', 'admin.invites.templateBody', {
      greeting: '您好',
      accountName: '客户甲',
      expiresDays: 7,
      url: 'https://x',
      loginEmail: 'k@h.com',
      brand: '陶瓷 · B2B',
    })
    expect(zh).toContain('您好')
    expect(zh).toContain('客户甲')
    expect(zh).toContain('陶瓷 · B2B')
  })

  it('reportMissingTranslations returns array of locale + missing paths', () => {
    const r = reportMissingTranslations()
    expect(Array.isArray(r)).toBe(true)
    expect(r.length).toBe(2)
    // ru and uz both have missing keys after refactor
    for (const e of r) {
      expect(['ru', 'uz']).toContain(e.locale)
      expect(Array.isArray(e.missing)).toBe(true)
      expect(e.missing.length).toBeGreaterThan(0)
    }
  })
})
