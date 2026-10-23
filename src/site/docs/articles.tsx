import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AppLink, Callout, SignInLink } from '../ui'

export interface DocSection {
  id: string
  title: string
  body: ReactNode
  /** Extra words people might search for that do not appear in the title. */
  keywords?: string
}

export interface DocArticle {
  slug: string
  title: string
  summary: string
  sections: DocSection[]
}

// Written from the current implementation. When behaviour changes, change the
// article in the same commit.
export const articles: DocArticle[] = [
  {
    slug: 'getting-started',
    title: 'Getting started',
    summary: 'Create your vault, upload your first documents and find your way around.',
    sections: [
      {
        id: 'what-you-need',
        title: 'What you need',
        keywords: 'requirements browser google account',
        body: (
          <ul>
            <li>A Google account. Your documents are stored in its Google Drive.</li>
            <li>
              A current version of Chrome, Edge, Safari or Firefox, or the <Link to="/documentation/desktop-app">desktop app</Link>.
            </li>
            <li>Pop-ups allowed for this site, because Google sign-in opens in a small window.</li>
          </ul>
        ),
      },
      {
        id: 'create-your-vault',
        title: 'Create your vault',
        keywords: 'sign up register sign in login first time consent permission',
        body: (
          <>
            <ol>
              <li>
                Choose <SignInLink to="/register">Get started</SignInLink> (or <SignInLink to="/login">Sign in</SignInLink>; they work the
                same way).
              </li>
              <li>Choose Continue with Google and pick your account.</li>
              <li>
                Google asks whether Document Vault may “see, edit, create and delete only the specific Google Drive files you use
                with this app”. Allow it. Document Vault cannot see any other files in your Drive.
              </li>
              <li>
                Your workspace opens. A folder called <strong>Document Vault</strong> is created in your Google Drive the first
                time; everything you upload is stored there.
              </li>
            </ol>
            <p>There is no separate sign-up form or password. Signing in again later opens the same vault.</p>
          </>
        ),
      },
      {
        id: 'first-upload',
        title: 'Upload your first documents',
        keywords: 'add files drag drop',
        body: (
          <ol>
            <li>Choose Upload in the sidebar (or drag files onto the page).</li>
            <li>Pick Upload Files for individual documents or Upload Folder to bring in a whole folder with its sub-folders.</li>
            <li>Choose a category and destination folder, then start the upload. Progress shows for each item.</li>
          </ol>
        ),
      },
      {
        id: 'finding-your-way',
        title: 'Finding your way around',
        keywords: 'sidebar navigation home menu',
        body: (
          <>
            <p>The sidebar (or the bar at the bottom on a phone) leads to:</p>
            <ul>
              <li><strong>Home</strong>: recent activity, storage use and your folders.</li>
              <li><strong>All files</strong> and <strong>Folders</strong>: everything in your vault.</li>
              <li><strong>Recent</strong>, <strong>Favorites</strong> and <strong>Categories</strong>: quick views.</li>
              <li><strong>My Libraries</strong>: folders on your computer you chose to search, when using the desktop app.</li>
              <li><strong>Search</strong>: your libraries and your uploaded documents, by title, name or the text inside.</li>
              <li><strong>Trash</strong> and <strong>Settings</strong>.</li>
            </ul>
            <p>
              Press <kbd>Ctrl</kbd> + <kbd>K</kbd> anywhere to jump to search.
            </p>
          </>
        ),
      },
      {
        id: 'signing-out',
        title: 'Signing out',
        keywords: 'log out logout shared computer',
        body: (
          <p>
            Open the account menu at the top right and choose Log out. Signing out also removes the offline copies and prepared
            previews kept in that browser, which matters on a shared computer.
          </p>
        ),
      },
    ],
  },
  {
    slug: 'web-app',
    title: 'Using the web app',
    summary: 'Previews, fast opening, offline copies, appearance and settings.',
    sections: [
      {
        id: 'opening',
        title: 'Opening and previewing documents',
        keywords: 'viewer preview pdf word excel powerpoint slideshow epub zip audio video',
        body: (
          <>
            <p>Click any document to open it in the viewer. These open directly in the browser:</p>
            <ul>
              <li>PDF, of any length. Long documents open on page one and draw pages as you scroll.</li>
              <li>Word (.docx), spreadsheets (.xlsx, .xls, .ods, .csv, .tsv) and PowerPoint (.pptx) with a slideshow.</li>
              <li>Web pages saved as .htm or .html, shown as the page rather than its code.</li>
              <li>Images, text and data files, e-books (.epub), audio and video.</li>
              <li>ZIP files show their list of contents; nothing is extracted.</li>
            </ul>
            <p>
              Older Office formats (.doc, .ppt) and OpenDocument text and presentations use Google Drive’s own preview. Anything
              else can be downloaded.
            </p>
            <p>
              An internet shortcut (.url or .webloc) shows its web address with a button to open it. Program files and Windows
              shortcuts (.exe, .lnk and similar) are never run; the viewer says so instead.
            </p>
          </>
        ),
      },
      {
        id: 'fast-opening',
        title: 'Fast opening on this device',
        keywords: 'prepared previews cache speed slow background preparing',
        body: (
          <>
            <p>
              Documents you upload or open are prepared in the background: the page count and the first pages of PDFs, and the
              first slides of decks, are kept in this browser. Next time they appear almost at once, even before the rest of
              the file has downloaded.
            </p>
            <p>
              Cards show the state: Queued, Preparing, Ready, Waiting or Preview failed. In Settings, “Fast opening on this
              device” shows how much space is used, lets you retry failures and removes all prepared copies.
            </p>
            <p>Prepared copies never leave the device, and each device prepares its own.</p>
          </>
        ),
      },
      {
        id: 'offline-copies',
        title: 'Offline copies',
        keywords: 'offline storage indexeddb',
        body: (
          <p>
            Documents you open are kept in the browser so they open again without downloading. When space runs low the least
            recently used copies are removed first. Signing out removes them all.
          </p>
        ),
      },
      {
        id: 'google-drive-connection',
        title: 'The Google Drive connection',
        keywords: 'reconnect drive token expired connect',
        body: (
          <p>
            Access to Google Drive is renewed every hour for security. When it has lapsed, a Connect button appears; opening a
            document that is not stored on the device starts the Google window straight away. Your account is already filled
            in, so it takes one click.
          </p>
        ),
      },
      {
        id: 'settings',
        title: 'Settings',
        keywords: 'theme dark mode light view grid list sort ocr text recognition',
        body: (
          <ul>
            <li><strong>Appearance</strong>: light or dark.</li>
            <li><strong>Library defaults</strong>: grid or list, sort order and the category filter.</li>
            <li>
              <strong>Text in pictures and scans</strong>: turn text recognition on or off. It runs in your browser and reads up
              to 30 pages per document.
            </li>
            <li><strong>Fast opening on this device</strong>: see above.</li>
            <li><strong>Install as an app</strong>: steps for each device.</li>
          </ul>
        ),
      },
    ],
  },
  {
    slug: 'file-management',
    title: 'Managing files and folders',
    summary: 'Uploading, folders, categories, tags, versions, copies, trash and restore.',
    sections: [
      {
        id: 'uploading',
        title: 'Uploading',
        keywords: 'upload folder drag drop progress duplicate compression resize photos',
        body: (
          <>
            <ul>
              <li>Upload single files, many files, or whole folders. Folder names and sub-folders are kept exactly.</li>
              <li>Each upload shows its own progress and can be retried if the connection drops.</li>
              <li>
                Before uploading, each file’s contents are fingerprinted in the browser. If the same file is already in your
                vault you are told where, instead of storing it twice.
              </li>
              <li>
                <strong>Photos</strong> (JPEG, PNG, WebP) are resized to at most 1600 pixels on the longest side before upload
                to save space. Other files, including PDFs and Office documents, upload unchanged. If you need a full-resolution
                photo, put it in a ZIP file first.
              </li>
            </ul>
          </>
        ),
      },
      {
        id: 'folders',
        title: 'Folders',
        keywords: 'new folder move breadcrumbs nested',
        body: (
          <p>
            Create folders from Folders or while uploading. Open a folder to see its contents, with breadcrumbs back up the
            tree. Use Move to folder from a file’s menu, or select several items and move them together.
          </p>
        ),
      },
      {
        id: 'categories-and-tags',
        title: 'Categories, descriptions and tags',
        keywords: 'edit details category tag description label',
        body: (
          <>
            <p>
              Every file has a category: Personal, School, Military, Work, Certificates, Reports or Other. Choose Edit details
              from a file’s menu to change the category, add a description, or add tags.
            </p>
            <p>
              Tags are free-form words such as <code>passport</code> or <code>2025</code>. Search for <code>#passport</code> to
              find everything with that tag.
            </p>
          </>
        ),
      },
      {
        id: 'favorites-recent',
        title: 'Favorites and recent files',
        keywords: 'star favourite recent',
        body: <p>Click the star on any file to add it to Favorites. Recent lists what you opened or uploaded lately.</p>,
      },
      {
        id: 'versions',
        title: 'Version history',
        keywords: 'new version restore previous older',
        body: (
          <p>
            Choose Version history from a file’s menu to upload a newer version, download or restore an older one, or delete a
            version you no longer need. Restoring makes the old version current; nothing is lost.
          </p>
        ),
      },
      {
        id: 'copies-rename',
        title: 'Copies and renaming',
        keywords: 'make a copy duplicate rename',
        body: (
          <p>
            Make a copy creates a second file in the same folder with the same details. Rename changes the name in your vault
            and in Google Drive; the file extension is kept.
          </p>
        ),
      },
      {
        id: 'trash',
        title: 'Trash and restore',
        keywords: 'delete remove restore permanently empty bin',
        body: (
          <>
            <p>
              Move to Trash hides a file or folder from your library but keeps it, so a mistake can be undone. Open Trash to
              restore items, or choose Delete permanently to remove them from Google Drive for good.
            </p>
            <Callout tone="warn">Delete permanently cannot be undone.</Callout>
          </>
        ),
      },
      {
        id: 'in-google-drive',
        title: 'Your files in Google Drive',
        keywords: 'drive folder export leave backup',
        body: (
          <p>
            Everything you upload is in the Document Vault folder of your Google Drive, so you can always reach your files
            through Google Drive itself, even without Document Vault. Avoid moving or renaming files there directly; use
            Document Vault so its records stay in step.
          </p>
        ),
      },
    ],
  },
  {
    slug: 'search',
    title: 'Searching',
    summary: 'Find documents by name, tag, folder or the words inside them.',
    sections: [
      {
        id: 'basics',
        title: 'Search basics',
        keywords: 'find ctrl k shortcut',
        body: (
          <>
            <p>
              Type in the search box at the top, or press <kbd>Ctrl</kbd> + <kbd>K</kbd>. Results update as you type and
              match file names, folder names, categories, descriptions and tags. Partial words work.
            </p>
          </>
        ),
      },
      {
        id: 'inside-documents',
        title: 'Searching inside documents',
        keywords: 'full text content words excerpt found in the text',
        body: (
          <p>
            The text of PDFs, Word files, spreadsheets, PowerPoint decks, web pages and text files is read when they are
            uploaded. Results that match inside a document show “Found in the text” with an excerpt.
          </p>
        ),
      },
      {
        id: 'scans-and-photos',
        title: 'Scans and photos of documents',
        keywords: 'ocr text recognition scanned image picture',
        body: (
          <p>
            With text recognition on (Settings, “Text in pictures and scans”), Document Vault reads the words in photos and
            scanned PDFs, up to 30 pages each, so search can find them. It runs in your browser and nothing is sent anywhere,
            but it can be slow for large scans.
          </p>
        ),
      },
      {
        id: 'tags',
        title: 'Searching by tag',
        keywords: 'hash tag #',
        body: (
          <p>
            Start a word with <code>#</code> to match tags only, for example <code>#certificate</code>. Combine it with other
            words to narrow the results.
          </p>
        ),
      },
      {
        id: 'this-computer',
        title: 'Files on this computer',
        keywords: 'desktop local library search typo filters full text page phrase',
        body: (
          <>
            <p>
              In the <Link to="/documentation/desktop-app">desktop app</Link>, the Search page also searches your{' '}
              <Link to="/documentation/desktop-app#libraries">libraries</Link>. Choose Local Library, Document Vault or Both, and
              whether to search Everything, Titles and names, or Full text. Each result says where it came from and why it
              matched, and text matches show the passage and its page number, with Open at page to go straight to it.
            </p>
            <p>
              Use quotes for an exact phrase (<code>"reasonable person"</code>), OR for either word, and a minus to leave a word
              out (<code>-draft</code>). Name search tolerates small typing mistakes. Results can be narrowed by library, type,
              author and date.
            </p>
          </>
        ),
      },
    ],
  },
  {
    slug: 'pwa',
    title: 'Installing as an app',
    summary: 'Add Document Vault to your phone or computer from the browser.',
    sections: [
      {
        id: 'what-it-is',
        title: 'What installing does',
        keywords: 'pwa progressive web app home screen',
        body: (
          <p>
            Installing adds Document Vault to your home screen, Dock or Start menu. It opens in its own window without browser
            controls and starts straight at your workspace. It is the same web app and the same account; updates arrive
            automatically when the site is updated.
          </p>
        ),
      },
      {
        id: 'iphone-ipad',
        title: 'iPhone and iPad',
        keywords: 'ios safari add to home screen',
        body: (
          <ol>
            <li>Open the web app in Safari.</li>
            <li>Tap the Share button.</li>
            <li>Choose Add to Home Screen, then Add.</li>
          </ol>
        ),
      },
      {
        id: 'android',
        title: 'Android',
        keywords: 'chrome install app add to home screen',
        body: (
          <ol>
            <li>Open the web app in Chrome.</li>
            <li>Tap the ⋮ menu.</li>
            <li>Choose Install app (or Add to Home screen).</li>
          </ol>
        ),
      },
      {
        id: 'computer',
        title: 'Windows, Mac, Linux and ChromeOS',
        keywords: 'chrome edge safari dock install icon',
        body: (
          <>
            <p>
              In Chrome or Edge, click the install icon at the right of the address bar, or open the browser menu and choose
              Install Document Vault. In Safari 17 or later on a Mac, choose File, then Add to Dock.
            </p>
            <p>
              The <Link to="/downloads#install">Downloads page</Link> shows an Install button when your browser supports it.
              Firefox on computers cannot install web apps.
            </p>
          </>
        ),
      },
      {
        id: 'offline-behaviour',
        title: 'Offline behaviour',
        keywords: 'offline no internet service worker cache',
        body: (
          <>
            <p>
              The app’s own code is kept on the device so it starts quickly, and documents you opened before open from their
              copies on the device without downloading again. Signing in, loading your library, uploading and anything else that
              talks to Google Drive need an internet connection.
            </p>
            <p>The installed app never caches your account data, search results or Drive files in its app cache.</p>
          </>
        ),
      },
      {
        id: 'uninstall',
        title: 'Removing the installed app',
        keywords: 'uninstall delete remove',
        body: (
          <p>
            Remove it like any other app: long-press the icon on a phone, or use the app’s menu (⋮) and choose Uninstall on a
            computer. Your vault is not affected; it stays in your Google Drive.
          </p>
        ),
      },
    ],
  },
  {
    slug: 'desktop-app',
    title: 'Desktop app',
    summary: 'Install the app on Windows, macOS or Linux and search the books and documents on your computer.',
    sections: [
      {
        id: 'what-it-adds',
        title: 'What the desktop app adds',
        keywords: 'electron local files index',
        body: (
          <>
            <p>
              The desktop app is the Document Vault workspace in its own window, plus <strong>My Libraries</strong>: search,
              preview and open books and documents that are already on your computer, without uploading them.
            </p>
            <p>It reads only folders you choose. Nothing on your computer is uploaded unless you upload it yourself.</p>
          </>
        ),
      },
      {
        id: 'install-windows',
        title: 'Install on Windows',
        keywords: 'windows installer exe smartscreen',
        body: (
          <ol>
            <li>
              Download the Windows installer from <Link to="/downloads">Downloads</Link>.
            </li>
            <li>
              Run it. If Windows shows “Windows protected your PC”, choose More info, then Run anyway. This appears because the
              installer is not yet signed with a paid certificate.
            </li>
            <li>Choose where to install it and finish. Document Vault appears in the Start menu.</li>
          </ol>
        ),
      },
      {
        id: 'install-macos',
        title: 'Install on macOS',
        keywords: 'mac dmg apple silicon intel gatekeeper open anyway',
        body: (
          <>
            <ol>
              <li>
                Download the disk image for your Mac: <strong>Apple Silicon</strong> for M1 and later, <strong>Intel</strong> for
                older Macs. Apple menu, About This Mac tells you which you have.
              </li>
              <li>Open the disk image and drag Document Vault into Applications.</li>
              <li>
                Open it. Until the app is notarised by Apple, macOS refuses the first time: open System Settings, Privacy &amp;
                Security, and choose Open Anyway next to Document Vault.
              </li>
            </ol>
            <Callout>The Mac builds are produced on macOS build machines. Check the Downloads page to see which are published.</Callout>
          </>
        ),
      },
      {
        id: 'install-linux',
        title: 'Install on Linux',
        keywords: 'appimage deb ubuntu debian fuse',
        body: (
          <ul>
            <li>
              <strong>Debian and Ubuntu</strong>: install the <code>.deb</code> with{' '}
              <code>sudo apt install ./Document-Vault-*.deb</code>.
            </li>
            <li>
              <strong>Other distributions</strong>: make the AppImage executable (<code>chmod +x</code>) and run it. Some
              systems need <code>libfuse2</code> first.
            </li>
          </ul>
        ),
      },
      {
        id: 'signing-in',
        title: 'Signing in',
        keywords: 'google login desktop browser couldn’t sign you in not secure',
        body: (
          <>
            <p>
              Google does not allow signing in inside desktop apps, so choosing Continue with Google opens a sign-in page in
              your usual web browser. Continue with Google there, and the app signs you in straight away. Your browser does not
              stay signed in, and Document Vault never sees your password.
            </p>
            <p>
              When sign-in finishes, the page takes you back to the app. If your browser asks whether to open Document Vault,
              allow it, or choose Open Document Vault on the page.
            </p>
            <p>
              Google Drive access lasts about an hour at a time. When it runs out, choose Reconnect Google Drive in the app and
              confirm in your browser.
            </p>
            <Callout>
              Version 1.0.0 tried to sign in inside the app, which Google blocks with “Couldn’t sign you in”. Install the latest
              version from <Link to="/downloads">Downloads</Link>.
            </Callout>
          </>
        ),
      },
      {
        id: 'libraries',
        title: 'Libraries: searching folders on your computer',
        keywords: 'library add folder index subfolders exclude rescan show in folder open desktop files',
        body: (
          <>
            <p>
              A library is a folder you allow Document Vault to read, such as the folder that holds your law books. Document
              Vault reads nothing else on your computer.
            </p>
            <ol>
              <li>Open My Libraries from the sidebar and choose Add library.</li>
              <li>Pick the folder in your computer’s own folder window.</li>
              <li>
                Name the library and choose whether to include subfolders (and how deep), which file types to include, and
                whether to read the text inside documents.
              </li>
              <li>Names are indexed first, so titles can be searched within seconds; the text is read in the background.</li>
            </ol>
            <p>
              Text is read from PDF, Word (.docx), EPUB, PowerPoint (.pptx), web pages (.htm, .html), text and RTF files, with
              page numbers for PDFs. Other files are searchable by name. Every file that is skipped is listed with the reason on
              the library’s Health tab.
            </p>
            <p>
              Scanned books are pictures of pages, so their words cannot be read directly. When a library holds scans, Document
              Vault asks once whether to recognise their text (OCR). If you agree, it recognises the scanned pages in the
              background on this computer, in English, about 5 to 10 seconds per page (a 300-page book can take 30 to 50 minutes); nothing is uploaded and no extra download is
              needed. Recognised passages are marked “Recognised text (OCR)” in search results because they may contain errors.
              You can turn recognition on or off for each library under Settings &amp; access; turning it off keeps the text
              already recognised. JPEG and PNG pictures are recognised too when the library includes images.
            </p>
            <p>
              On the library’s Folders tab you can exclude a subfolder: its files leave the index and search at once. The
              library stays current as files are added, changed, moved or deleted. Programs and scripts are never opened, and
              system folders (such as Windows, Program Files, /System or /usr) cannot be added.
            </p>
            <Callout>The extracted text and the index stay on this computer. They are not uploaded.</Callout>
          </>
        ),
      },
      {
        id: 'book-links',
        title: 'Catalog pages and book links',
        keywords: 'htm html catalog index page link broken reference',
        body: (
          <>
            <p>
              Many collections use .htm pages as catalogs that link to the books. Document Vault reads those links without
              running the page. The Book links tab lists each one as Found, Broken, Not indexed, Outside library or Web link,
              and a search result shows which catalog pages refer to that book.
            </p>
            <p>Links that point outside your libraries are never followed, and web links are never fetched.</p>
          </>
        ),
      },
      {
        id: 'library-access',
        title: 'Pause, revoke, clear or remove a library',
        keywords: 'revoke permission access remove purge clear index pause privacy ai',
        body: (
          <>
            <ul>
              <li>
                <strong>Pause</strong>: changes on disk are no longer picked up; search still uses what was already indexed.
              </li>
              <li>
                <strong>Revoke access</strong>: Document Vault stops reading the folder at once, and nothing from it appears
                in search, lists or links until you grant access again.
              </li>
              <li>
                <strong>Clear the index</strong>: deletes the names, text, metadata and links indexed from the folder,
                including corrections you made to titles or authors. The library stays, paused.
              </li>
              <li>
                <strong>Remove library</strong>: removes the library and its index from Document Vault.
              </li>
            </ul>
            <p>None of these touch the folder or its files. Document Vault never deletes, moves or edits your books.</p>
            <p>
              If a folder becomes unreadable (on a Mac, for example, after access to it was withdrawn), the library shows
              Permission needed. Choose Grant access again and pick the same folder. If the drive holding a library is
              disconnected, it shows Not available and its index is kept until the drive returns.
            </p>
            <p>
              The Library access page lists every library, its exclusions and recent changes. AI search is off: no AI feature
              can read your libraries.
            </p>
          </>
        ),
      },
      {
        id: 'connect-a-browser',
        title: 'Using your libraries from a browser',
        keywords: 'pairing code companion browser',
        body: (
          <p>
            While the desktop app is open, a browser on the same computer can search your libraries too. In the desktop app,
            choose Help, then Connect a browser, to see a one-time pairing code; type it on the My Libraries page in the
            browser.
          </p>
        ),
      },
      {
        id: 'updates',
        title: 'Updates',
        keywords: 'update new version upgrade',
        body: (
          <p>
            The desktop app checks for a new release when it starts and offers to open the Downloads page when one is
            available. The workspace inside the app is updated with each desktop release. Choose Help, then Check for updates,
            to check at any time.
          </p>
        ),
      },
      {
        id: 'uninstall-desktop',
        title: 'Uninstalling',
        keywords: 'remove uninstall',
        body: (
          <p>
            On Windows, use Settings, Apps. On macOS, drag Document Vault from Applications to the Bin. On Linux, remove the
            package or delete the AppImage. Your vault stays in your Google Drive.
          </p>
        ),
      },
    ],
  },
  {
    slug: 'troubleshooting',
    title: 'Troubleshooting',
    summary: 'Fixes for sign-in, Google Drive, uploads, previews and the desktop app.',
    sections: [
      {
        id: 'popup-blocked',
        title: 'The Google sign-in window does not appear',
        keywords: 'popup blocked sign in',
        body: (
          <p>
            Your browser blocked the pop-up. Allow pop-ups for this site (the address bar shows a blocked pop-up icon) and
            choose Continue with Google again.
          </p>
        ),
      },
      {
        id: 'unauthorized-domain',
        title: '“This domain is not authorized”',
        keywords: 'auth unauthorized domain firebase',
        body: (
          <p>
            You opened Document Vault from an address that is not set up for sign-in, such as a local network address. Use the
            main address, or ask the administrator to add the address in the sign-in settings.
          </p>
        ),
      },
      {
        id: 'drive-not-connected',
        title: '“Google Drive is not connected”',
        keywords: 'reconnect drive token',
        body: (
          <p>
            Access to Drive lapses after an hour. Choose Connect (or open a document) and confirm in the Google window. If Google
            asks for permission again, allow access to the files Document Vault uses.
          </p>
        ),
      },
      {
        id: 'upload-fails',
        title: 'An upload fails or stalls',
        keywords: 'upload error retry quota storage full',
        body: (
          <ul>
            <li>Check your connection, then choose Retry on the upload.</li>
            <li>If Google Drive is full, free up space in your Google account.</li>
            <li>“Already in your vault” means the same file was uploaded before; the message says where.</li>
          </ul>
        ),
      },
      {
        id: 'preview-fails',
        title: 'A document will not preview',
        keywords: 'preview failed opening document stuck loading',
        body: (
          <ul>
            <li>Download the file and open it on your device; the file itself is safe in your Drive.</li>
            <li>
              If documents stay on “Opening document...”, close other Document Vault tabs and windows, then reload. An older
              tab can hold the offline store open.
            </li>
            <li>In Settings, “Fast opening on this device” lets you try failed preparations again.</li>
          </ul>
        ),
      },
      {
        id: 'missing-from-search',
        title: 'A document does not show up in search',
        keywords: 'search missing not found',
        body: (
          <ul>
            <li>Check the spelling, or search for part of the name.</li>
            <li>Clear any category filter on the page.</li>
            <li>Text inside a document is searchable once it has been read after upload; scans need text recognition turned on.</li>
            <li>Look in Trash.</li>
          </ul>
        ),
      },
      {
        id: 'desktop-warnings',
        title: 'Windows or macOS warns about the desktop app',
        keywords: 'smartscreen gatekeeper unsigned cannot be opened',
        body: (
          <p>
            The desktop app is not yet code-signed. See <Link to="/documentation/desktop-app#install-windows">Install on
            Windows</Link> and <Link to="/documentation/desktop-app#install-macos">Install on macOS</Link> for how to open it
            safely, and check the SHA-256 checksum listed on the Downloads page.
          </p>
        ),
      },
      {
        id: 'desktop-files-empty',
        title: 'Searching my libraries finds nothing',
        keywords: 'desktop files libraries no results index pairing full text scanned',
        body: (
          <ul>
            <li>Make sure you added at least one library and that it shows Up to date on My Libraries.</li>
            <li>Text is read in the background after names; while a library shows Reading text, some text is not searchable yet.</li>
            <li>
              Scanned PDFs are found by name only until their text is recognised. Turn on text recognition for the library under
              Settings &amp; access; the Health tab lists scans waiting, scans that could not be recognised and those recognised with
              low confidence.
            </li>
            <li>Check that the library is not revoked and that the folder you expect is not excluded.</li>
            <li>In a browser, the desktop app must be open and paired; see “Using your libraries from a browser”.</li>
          </ul>
        ),
      },
      {
        id: 'still-stuck',
        title: 'Still stuck?',
        keywords: 'help contact support',
        body: (
          <p>
            Sign out and in again, or open the <AppLink>web app</AppLink> in another browser to see whether the problem is
            specific to one device. Document Vault is used by a small group; report problems to the person who set it up for
            you.
          </p>
        ),
      },
    ],
  },
]

export function findArticle(slug: string | undefined) {
  return articles.find((article) => article.slug === slug)
}

export interface DocHit {
  article: DocArticle
  section: DocSection | null
}

export function searchDocs(query: string): DocHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const hits: { hit: DocHit; score: number }[] = []
  for (const article of articles) {
    const articleText = `${article.title} ${article.summary}`.toLowerCase()
    if (words.every((word) => articleText.includes(word))) hits.push({ hit: { article, section: null }, score: 3 })
    for (const section of article.sections) {
      const text = `${section.title} ${section.keywords ?? ''} ${article.title}`.toLowerCase()
      const matched = words.filter((word) => text.includes(word)).length
      if (matched === words.length) hits.push({ hit: { article, section }, score: section.title.toLowerCase().includes(words[0]) ? 2 : 1 })
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 12).map((entry) => entry.hit)
}
