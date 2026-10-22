import { useEffect } from 'react'

const SITE_NAME = 'Document Vault'

// Each page sets its own title and description for tabs, bookmarks and search.
export function usePageMeta(title: string, description: string) {
  useEffect(() => {
    document.title = title === SITE_NAME ? title : `${title} | ${SITE_NAME}`
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'description'
      document.head.appendChild(meta)
    }
    meta.content = description
  }, [title, description])
}
