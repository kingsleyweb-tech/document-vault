import { describe, expect, it } from 'vitest'
import { articles, findArticle, searchDocs } from './articles'

describe('documentation', () => {
  it('has every article the site links to, each with content', () => {
    const slugs = articles.map((article) => article.slug)
    expect(slugs).toEqual(['getting-started', 'web-app', 'file-management', 'search', 'pwa', 'desktop-app', 'troubleshooting'])
    for (const article of articles) {
      expect(article.sections.length).toBeGreaterThan(2)
      expect(new Set(article.sections.map((section) => section.id)).size).toBe(article.sections.length)
    }
  })

  it('finds articles and sections', () => {
    expect(findArticle('search')?.title).toBe('Searching')
    expect(findArticle('nope')).toBeUndefined()
    expect(searchDocs('')).toEqual([])
    const popup = searchDocs('popup')
    expect(popup[0].section?.id).toBe('popup-blocked')
    expect(searchDocs('apple silicon').some((hit) => hit.section?.id === 'install-macos')).toBe(true)
  })
})
