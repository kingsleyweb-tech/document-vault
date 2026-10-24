import { useEffect, useRef, useState } from 'react'
import type { TiffDocument } from '../../services/fileFormats'

// The pages of a TIFF picture (often a multi-page scan). A page is drawn when
// it comes near the view, one at a time, so a long scan opens at once and
// only the pages looked at take memory.
export function TiffPages({ tiff, name }: { tiff: TiffDocument; name: string }) {
  const [pictures, setPictures] = useState<Record<number, string>>({})
  const [failed, setFailed] = useState<Record<number, boolean>>({})
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const list = listRef.current
    if (!list) return undefined
    const urls: string[] = []
    const wanted = new Set<number>()
    const started = new Set<number>()
    let drawing = false
    let stopped = false

    const pump = async () => {
      if (drawing || stopped) return
      const next = [...wanted].sort((a, b) => a - b).find((index) => !started.has(index))
      if (next === undefined) return
      drawing = true
      started.add(next)
      try {
        const url = await tiff.render(next)
        if (stopped) {
          URL.revokeObjectURL(url)
          return
        }
        urls.push(url)
        setPictures((current) => ({ ...current, [next]: url }))
      } catch {
        if (!stopped) setFailed((current) => ({ ...current, [next]: true }))
      } finally {
        drawing = false
        void pump()
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.page)
          if (entry.isIntersecting) wanted.add(index)
          else wanted.delete(index)
        }
        void pump()
      },
      { root: list.closest('.local-preview__body'), rootMargin: '800px 0px' },
    )
    list.querySelectorAll('[data-page]').forEach((element) => observer.observe(element))
    return () => {
      stopped = true
      observer.disconnect()
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [tiff])

  return (
    <div className="tiff-pages" ref={listRef}>
      {Array.from({ length: tiff.pages }, (_, index) => (
        <figure key={index} className="tiff-pages__page" data-page={index}>
          {pictures[index] ? (
            <img src={pictures[index]} alt={tiff.pages > 1 ? `${name}, page ${index + 1}` : name} />
          ) : (
            <span className="tiff-pages__placeholder">{failed[index] ? 'This page could not be drawn.' : `Page ${index + 1}`}</span>
          )}
          {tiff.pages > 1 ? <figcaption>Page {index + 1} of {tiff.pages}</figcaption> : null}
        </figure>
      ))}
    </div>
  )
}
