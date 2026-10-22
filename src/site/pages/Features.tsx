import { CheckCircle2 } from 'lucide-react'
import { features } from '../content'
import { ArrowLink, ClosingCta, PageHead, SectionHead } from '../ui'
import { usePageMeta } from '../meta'

const formats = [
  ['PDF', 'Built-in reader for documents of any length, opening on page one'],
  ['Word (.docx)', 'Built-in reader; older .doc files use the Google Drive preview'],
  ['Excel and spreadsheets', '.xlsx, .xls, .ods, .csv and .tsv, read in the browser'],
  ['PowerPoint (.pptx)', 'Slides, slideshow, transitions and animations; .ppt uses the Google Drive preview'],
  ['Images', 'JPEG, PNG, WebP, GIF and other formats the browser can show'],
  ['Text and data', 'Plain text, Markdown, JSON, XML, YAML, logs, RTF and code, shown as text and never run'],
  ['E-books (.epub)', 'Reader with a table of contents and chapters'],
  ['Audio and video', 'Played with the browser’s built-in player'],
  ['ZIP archives', 'Lists the contents without extracting anything'],
]

export default function Features() {
  usePageMeta('Features', 'Upload, organise, search and preview documents stored in your own Google Drive.')

  return (
    <>
      <PageHead eyebrow="Features" title="A careful home for important documents">
        Everything listed here is in the product today. Where something depends on your browser or device, the documentation
        says so.
      </PageHead>

      <section className="site-section">
        <div className="site-container">
          <div className="site-grid site-grid--3">
            {features.map((feature) => (
              <article key={feature.title} className="site-card">
                <span className="site-card__icon">
                  <feature.icon aria-hidden="true" />
                </span>
                <h2 className="site-card__title">{feature.title}</h2>
                <p>{feature.summary}</p>
                <ul>
                  {feature.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
                <div className="site-card__foot">
                  <ArrowLink to={feature.doc}>Learn more</ArrowLink>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="site-section site-section--sand" aria-labelledby="formats-title">
        <div className="site-container">
          <SectionHead eyebrow="Previews" title="File types you can open in the browser" id="formats-title">
            Anything else can still be stored, organised and downloaded.
          </SectionHead>
          <div className="site-prose site-prose--wide">
            <div className="site-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">How it opens</th>
                  </tr>
                </thead>
                <tbody>
                  {formats.map(([type, how]) => (
                    <tr key={type}>
                      <td>{type}</td>
                      <td>{how}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="site-section" aria-labelledby="limits-title">
        <div className="site-container site-split">
          <div>
            <span className="site-eyebrow">Good to know</span>
            <h2 id="limits-title" className="site-h2">
              What Document Vault does not do
            </h2>
          </div>
          <ul className="site-checks">
            <li>
              <CheckCircle2 aria-hidden="true" />
              <span>
                <strong>It is not a file-sharing service.</strong> Each person’s vault is private. There are no shared folders or
                public links.
              </span>
            </li>
            <li>
              <CheckCircle2 aria-hidden="true" />
              <span>
                <strong>It does not edit documents.</strong> Open a file in Google Drive or on your computer to change it, then
                upload it as a new version.
              </span>
            </li>
            <li>
              <CheckCircle2 aria-hidden="true" />
              <span>
                <strong>It needs a Google account.</strong> Your files are stored in Google Drive and count towards your Drive
                storage.
              </span>
            </li>
          </ul>
        </div>
      </section>

      <ClosingCta />
    </>
  )
}
