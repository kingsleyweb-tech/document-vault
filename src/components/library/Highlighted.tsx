import { excerptParts } from './libraryText'

// Shows an excerpt with its matching words marked. The text is rendered as
// text, never as HTML, so nothing in a document can run here.
export function Highlighted({ text }: { text: string }) {
  return (
    <>
      {excerptParts(text).map((part, index) => (part.hit ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>))}
    </>
  )
}
