import { Link } from 'react-router-dom'
import { Callout, PageHead, ReviewNote, ReadingLayout } from '../ui'
import { usePageMeta } from '../meta'

export default function Security() {
  usePageMeta('Security', 'How Document Vault protects your account and documents, and what is not done yet.')

  return (
    <>
      <PageHead eyebrow="Security" title="How your documents are protected">
        A plain description of how Document Vault works, including its current limits.
      </PageHead>
      <section className="site-section site-section--tight">
        <div className="site-container">
          <ReadingLayout>
            <h2 id="sign-in">Sign-in and access</h2>
            <ul>
              <li>
                You sign in with your Google account through Google’s own sign-in window. Document Vault never sees or stores
                your Google password.
              </li>
              <li>
                Document Vault asks Google for the narrowest Drive permission available for this kind of app
                (<code>drive.file</code>): access only to files it created or that you opened with it. It cannot list or read the
                rest of your Drive.
              </li>
              <li>
                Every record in the database belongs to one account. The database rules let each signed-in person read and change
                only their own records, and check the type and size of every field written.
              </li>
              <li>The workspace pages require sign-in; visiting them while signed out leads to the sign-in page.</li>
            </ul>

            <h2 id="where-data-lives">Where your data is kept</h2>
            <div className="site-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">What</th>
                    <th scope="col">Where</th>
                    <th scope="col">Who can reach it</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Your files</td>
                    <td>The Document Vault folder in your own Google Drive</td>
                    <td>You, through Document Vault or Google Drive</td>
                  </tr>
                  <tr>
                    <td>File details (name, folder, category, tags, description, dates)</td>
                    <td>Google Firebase (Firestore), with a copy in a Supabase database used for search</td>
                    <td>Your account only, enforced by database rules</td>
                  </tr>
                  <tr>
                    <td>Text read from your documents, used for searching inside them</td>
                    <td>The Supabase search database</td>
                    <td>Your account only, enforced by row-level security</td>
                  </tr>
                  <tr>
                    <td>Offline copies and prepared previews</td>
                    <td>Your browser’s storage on each device</td>
                    <td>That browser profile; removed when you sign out</td>
                  </tr>
                  <tr>
                    <td>Desktop Files index (file and folder names on your computer)</td>
                    <td>A file in the desktop app’s data folder on your computer</td>
                    <td>Your computer only; never uploaded</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              People who administer this Document Vault installation (its Firebase and Supabase projects) have administrator
              access to the databases, as with any hosted service. They cannot open the files in your Google Drive through
              Document Vault.
            </p>

            <h2 id="in-the-browser">In the browser</h2>
            <ul>
              <li>All traffic uses HTTPS.</li>
              <li>
                Documents are shown safely: text is displayed as text, Word and web documents are cleaned and shown in a sandbox,
                PDF forms that could run code are disabled, and PowerPoint macros are never run.
              </li>
              <li>
                Text recognition, preview preparation and duplicate checks run in your browser; your documents are not sent to
                any extra service for them.
              </li>
              <li>The public website has no analytics, advertising or tracking scripts.</li>
              <li>
                The service worker that makes the installed app start quickly caches only the app’s own files, never your Drive
                files, account data or search results.
              </li>
            </ul>

            <h2 id="desktop-app">Desktop app</h2>
            <ul>
              <li>
                The app window cannot run Node.js code or reach the operating system directly; it uses Electron’s context
                isolation and sandbox, and a small, fixed set of checked requests.
              </li>
              <li>
                Desktop Files only reads folders you add. System folders are refused, programs and scripts are never opened, and
                its local service listens only on your own computer and accepts only paired, recognised callers.
              </li>
              <li>Links to other sites open in your normal browser, not inside the app.</li>
            </ul>

            <h2 id="limits">Current limits</h2>
            <Callout tone="warn">
              These are known and deliberate trade-offs or work still to do. They are listed so you can judge for yourself.
            </Callout>
            <ul>
              <li>
                <strong>Google Drive access token in browser storage.</strong> To avoid asking Google again on every page load, the
                Drive access token is kept in the browser’s local storage for at most 55 minutes and removed on sign-out. It only
                grants access to files Document Vault uses.
              </li>
              <li>
                <strong>Content Security Policy in report-only mode.</strong> A strict policy is in place but only reports
                problems; it will be enforced once it has run cleanly on the live site.
              </li>
              <li>
                <strong>No end-to-end encryption.</strong> Files are protected by Google Drive’s own encryption and access control,
                not encrypted by Document Vault before upload. Search text is stored readable by the database, so that it can be
                searched.
              </li>
              <li>
                <strong>Desktop installers are not yet code-signed.</strong> Windows and macOS warn on first launch. Each download
                lists its SHA-256 checksum so you can verify it; see <Link to="/downloads">Downloads</Link>.
              </li>
              <li>
                <strong>No independent security audit</strong> has been carried out. The checks so far are the project’s own
                automated tests and reviews.
              </li>
            </ul>

            <h2 id="reporting">Reporting a security problem</h2>
            <p>
              If you find a security problem, tell the administrator who gave you access, privately, and do not share the details
              publicly until it is fixed. <ReviewNote>Public contact address to be confirmed</ReviewNote>
            </p>
          </ReadingLayout>
        </div>
      </section>
    </>
  )
}
