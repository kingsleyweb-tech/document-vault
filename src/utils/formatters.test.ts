import { describe, expect, it } from 'vitest'
import { escapeHtml, highlightPlainText } from './formatters'

describe('highlightPlainText', () => {
  it('shows markup in a text file as text instead of running it', () => {
    const text = '<img src=x onerror="alert(1)"> & <script>steal()</script>'
    expect(highlightPlainText(text, '')).toBe(escapeHtml(text))
    expect(highlightPlainText(text, '')).not.toContain('<img')
    expect(highlightPlainText(text, 'script')).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &lt;<mark>script</mark>&gt;steal()&lt;/<mark>script</mark>&gt;',
    )
  })

  it('marks every match case-insensitively, including regex characters', () => {
    expect(highlightPlainText('Cost (USD) and cost', 'cost')).toBe('<mark>Cost</mark> (USD) and <mark>cost</mark>')
    expect(highlightPlainText('a+b = c', 'a+b')).toBe('<mark>a+b</mark> = c')
  })

  it('can find text that contains characters which are escaped', () => {
    expect(highlightPlainText('R&D budget', 'R&D')).toBe('<mark>R&amp;D</mark> budget')
  })
})
