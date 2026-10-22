import { useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { MAX_TAGS, normalizeTags } from '../../utils/tags'

interface TagEditorProps {
  tags: string[]
  onChange: (tags: string[]) => void
  /** Tags used elsewhere in the vault, offered as suggestions. */
  suggestions?: string[]
}

// Type a tag and press Enter or comma to add it; Backspace in an empty box removes the last one.
export function TagEditor({ tags, onChange, suggestions = [] }: TagEditorProps) {
  const [draft, setDraft] = useState('')
  const full = tags.length >= MAX_TAGS

  const add = (text: string) => {
    const next = normalizeTags([...tags, ...text.split(',')])
    if (next.join() !== tags.join()) onChange(next)
    setDraft('')
  }

  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === 'Enter' || event.key === ',') && draft.trim()) {
      event.preventDefault()
      add(draft)
    } else if (event.key === 'Enter') {
      // An empty box lets Enter submit the dialog.
    } else if (event.key === 'Backspace' && !draft && tags.length > 0) {
      onChange(tags.slice(0, -1))
    }
  }

  const listId = 'tag-suggestions'
  const offered = suggestions.filter((tag) => !tags.includes(tag))

  return (
    <>
      <div className="tag-editor">
        {tags.map((tag) => (
          <span key={tag} className="doc-tag">
            #{tag}
            <button type="button" onClick={() => onChange(tags.filter((item) => item !== tag))} aria-label={`Remove tag ${tag}`}>
              <X aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          disabled={full}
          list={offered.length > 0 ? listId : undefined}
          onChange={(event) => {
            const value = event.target.value
            if (value.endsWith(',')) add(value)
            else setDraft(value)
          }}
          onKeyDown={handleKey}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={full ? `Up to ${MAX_TAGS} tags` : tags.length === 0 ? 'Add tags, e.g. tax, 2026' : 'Add another tag'}
          aria-label="Add a tag"
        />
      </div>
      {offered.length > 0 ? (
        <datalist id={listId}>
          {offered.slice(0, 50).map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
      ) : null}
    </>
  )
}
