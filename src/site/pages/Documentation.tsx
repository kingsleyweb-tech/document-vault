import { useId, useState } from 'react'
import { Link, NavLink, useParams } from 'react-router-dom'
import { BookOpen, Search } from 'lucide-react'
import { articles, findArticle, searchDocs, type DocArticle } from '../docs/articles'
import NotFound from './NotFound'
import { PageHead } from '../ui'
import { usePageMeta } from '../meta'

export default function Documentation() {
  const { slug } = useParams()
  if (!slug) return <DocsHome />
  const article = findArticle(slug)
  return article ? <ArticlePage article={article} /> : <NotFound />
}

function DocsHome() {
  usePageMeta('Documentation', 'Guides for the Document Vault web app, installed app and desktop app.')
  return (
    <>
      <PageHead eyebrow="Documentation" title="How to use Document Vault">
        Guides for the web app, the installed app and the desktop app, written from how they work today.
      </PageHead>
      <div className="site-container">
        <div className="site-docs">
          <DocsNav />
          <div className="site-prose site-prose--wide">
            <div className="site-grid site-grid--2">
              {articles.map((article) => (
                <Link key={article.slug} to={`/documentation/${article.slug}`} className="site-docs__result">
                  <strong>{article.title}</strong>
                  <span>{article.summary}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function ArticlePage({ article }: { article: DocArticle }) {
  usePageMeta(article.title, article.summary)
  const index = articles.indexOf(article)
  const previous = articles[index - 1]
  const next = articles[index + 1]

  return (
    <div className="site-container">
      <div className="site-docs">
        <DocsNav />
        <article className="site-prose">
          <p>
            <Link to="/documentation">Documentation</Link>
          </p>
          <h1 className="site-docs__title">{article.title}</h1>
          <p className="site-lead">{article.summary}</p>
          {article.sections.length > 3 ? (
            <nav aria-label="On this page" className="site-docs__toc">
              <strong>On this page</strong>
              <ul>
                {article.sections.map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`}>{section.title}</a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          {article.sections.map((section) => (
            <section key={section.id} aria-labelledby={section.id}>
              <h2 id={section.id}>{section.title}</h2>
              {section.body}
            </section>
          ))}
          <nav className="site-docs__pager" aria-label="More guides">
            {previous ? (
              <Link to={`/documentation/${previous.slug}`}>
                <small>Previous</small>
                {previous.title}
              </Link>
            ) : null}
            {next ? (
              <Link to={`/documentation/${next.slug}`}>
                <small>Next</small>
                {next.title}
              </Link>
            ) : null}
          </nav>
        </article>
      </div>
    </div>
  )
}

function DocsNav() {
  const [query, setQuery] = useState('')
  const inputId = useId()
  const hits = searchDocs(query)

  return (
    <aside className="site-docs__nav">
      <div role="search">
        <label htmlFor={inputId} className="site-visually-hidden">
          Search the documentation
        </label>
        <div className="site-field">
          <Search aria-hidden="true" />
          <input
            id={inputId}
            type="search"
            placeholder="Search the docs"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
          />
        </div>
      </div>
      {query.trim() ? (
        <div className="site-docs__results" aria-live="polite">
          {hits.length === 0 ? (
            <p className="site-build__pending">No guides match “{query.trim()}”.</p>
          ) : (
            hits.map((hit) => (
              <Link
                key={`${hit.article.slug}-${hit.section?.id ?? ''}`}
                to={`/documentation/${hit.article.slug}${hit.section ? `#${hit.section.id}` : ''}`}
                className="site-docs__result"
                onClick={() => setQuery('')}
              >
                <strong>{hit.section ? hit.section.title : hit.article.title}</strong>
                <span>{hit.section ? hit.article.title : hit.article.summary}</span>
              </Link>
            ))
          )}
        </div>
      ) : (
        <nav aria-label="Guides">
          <ul>
            <li>
              <NavLink to="/documentation" end>
                <BookOpen aria-hidden="true" className="site-inline-icon" /> Overview
              </NavLink>
            </li>
            {articles.map((article) => (
              <li key={article.slug}>
                <NavLink to={`/documentation/${article.slug}`}>{article.title}</NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </aside>
  )
}
