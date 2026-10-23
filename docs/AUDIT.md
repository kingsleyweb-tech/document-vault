# Document Vault: implementation audit and report

Sections A–L were written on `feature/desktop-search-audit`; sections M and N on `feature/product-website`, uncommitted. Nothing has been pushed or deployed.
Last updated 2026-10-23 (section N added).

Status words used throughout:

- **Verified**: implemented and checked by a test or a measured run.
- **Unverified**: implemented, but not exercised end to end here (usually because it needs Google sign-in or a deploy).
- **Partial**: implemented in part.
- **Missing**: not implemented.
- **Broken**: implemented but wrong.
- **Blocked**: needs a decision or approval from you.

---

## A. Feature audit

"Before" is the state found when this audit started. "Now" is the state at the end of the work.

### Desktop search (top priority)

| ID | Feature | Before | Now | Evidence |
|---|---|---|---|---|
| DV-001 | Local service that can read this computer's files | Missing. A website cannot read the disk. | Verified | `companion/`; 47 automated tests pass |
| DV-002 | Pairing a browser with the companion | Missing | Verified | Single-use 8-character code, valid 10 min; tokens stored as SHA-256 hashes (tests) |
| DV-003 | Choosing folders to index (picker or typed path), remove, rescan, pause | Missing | Verified | `IndexedFolders.tsx`; Chrome check adds a folder and waits for "Up to date" |
| DV-004 | Desktop Files page in the sidebar and mobile menu | Missing | Verified | `src/pages/DesktopFiles.tsx`, route `#/desktop` |
| DV-005 | Search names and folder paths, partial words | Missing | Verified | Chrome check: "annual", partial and folder searches |
| DV-006 | Typo tolerance ("anual budjet") | Missing | Verified | Edit-distance pass; benchmark finds "Annual Budget Summary.xlsx" in 1.2 ms |
| DV-007 | Filters (type, file or folder, location, modified, size), sort, "search inside" a folder | Missing | Verified | Chrome check |
| DV-008 | Paging through large result sets | Missing | Verified | 50 per page with "Show more"; counts capped at 5,000 |
| DV-009 | Show the real full path | Missing | Verified | Each row shows the full path and a Copy path button |
| DV-010 | Open with the Windows default app | Missing | Verified | Real Explorer window opened and closed by `npm --prefix companion run check:launcher` |
| DV-011 | Never open programs, scripts or shortcuts | Missing | Verified | 50 blocked extensions; tests; no Open button for `.exe`/`.lnk` in Chrome |
| DV-012 | Show in folder (Explorer with the file selected) | Missing | Verified | Launcher check |
| DV-013 | Preview local files without uploading (PDF, Word, Excel, PowerPoint, text, images, audio, video) | Missing | Verified | Chrome check previews PDF, DOCX, XLSX, PPTX (opens on slide 1), text and image |
| DV-014 | Index stays current when files are added, renamed, moved or deleted | Missing | Verified | Windows change notifications plus rescans; Chrome check deletes a file and it leaves the results |
| DV-015 | Unified search with honest source labels (This computer / Uploaded / All sources) | Missing | Verified | Every row carries a "This computer" or "Uploaded" badge; component tests |

### Search of uploaded documents

| ID | Feature | Before | Now | Evidence |
|---|---|---|---|---|
| DV-016 | Search uploaded documents by name and metadata | Verified (client-side filter) | Verified | Unchanged |
| DV-017 | Text extraction from uploaded documents (PDF, Word, Excel/ODS/CSV, PowerPoint, HTML, text, RTF) | Missing | Verified | 10 unit tests; in Chrome a 400-page PDF took 2.5 s and a 1,000-slide deck 0.9 s, with no frame over 42 ms |
| DV-018 | Full-text search with highlighted excerpts and paging | Missing (database function existed, nothing called it) | Unverified | Browser to Postgres path written; database side verified live (DB tests); UI verified with component tests. Not run with a signed-in account. |
| DV-019 | Paged search function `search_documents_page` | Missing | Blocked | Migration written and tested inside a rolled-back transaction; **not applied**. The app falls back to the existing `search_documents` until it is. |
| DV-020 | OCR of scanned PDFs and images | Missing | Missing | Would need a heavy library or a paid API |

### Database, Firebase and Drive

| ID | Feature | Before | Now | Evidence |
|---|---|---|---|---|
| DV-021 | Postgres (Supabase) schema with row-level security per Firebase user | Verified (built earlier this session) | Verified | 11 live tests in `tests/db/policies.test.ts`, all inside rolled-back transactions |
| DV-022 | Firestore to Postgres metadata mirror | Verified (unit) | Verified (unit) | `metadataMirror.test.ts`; live sync not re-run with a signed-in account |
| DV-023 | Firebase Authentication (Google sign-in with the `drive.file` scope) | Unverified | Unverified | Unchanged; automated sign-in is not possible here |
| DV-024 | Firestore rules: owner-only access | Verified (rules read) | Partial | Owner check is correct; there is no field allow-list on update (see G) |
| DV-025 | Drive upload, rename, move, trash, restore, permanent delete | Unverified | Unverified | Unchanged except rename (DV-030); trash and restore flows verified in the layout harness |
| DV-026 | Missing Drive files | **Broken**: background validation deleted records of files it could not find, including on transient errors | Unverified | No longer deletes anything. Missing files are flagged `driveMissing`, shown with a "Missing from Drive" badge and cannot be opened. One batched Drive listing replaces a request per file. Type-checked and component-tested, not run against a live Drive. |
| DV-027 | Drive storage quota | Unverified | Unverified | Shown in the sidebar (existing) |
| DV-028 | Duplicate uploads | Partial | Verified (fake Drive) | Each upload is hashed (SHA-256, in the browser). A file whose contents are already in the vault, under any name, waits for "Skip" or "Upload anyway" (also for all at once). Same name and size in the same folder is still skipped as before. See K |
| DV-029 | `drive_missing` in Postgres | Missing | Verified (DB) | Migration applied; the mirror sends the flag. See K |

### File management

| ID | Feature | Before | Now | Evidence |
|---|---|---|---|---|
| DV-030 | Rename | **Broken**: the Drive file lost its extension ("Report.pdf" became "Report"), and the download name kept the old name | Unverified | Extension kept and `originalName` updated; the helper is unit-tested. The Drive call has not been run live. |
| DV-031 | Move, trash, restore, delete permanently, bulk actions | Verified (harness) | Verified (harness) | Layout check trash, restore and bulk flows pass |
| DV-032 | Edit category and description | Missing | Unverified | "Edit details" in each file's menu; needs a signed-in check |
| DV-033 | Copy a file | Missing | Unverified | "Make a copy" in the file menu: Drive `files.copy` into the same folder, plus a record with the same details. Request shape unit-tested; not run against a live Drive |
| DV-034 | Free-form tags | Missing | Verified (unit, rules, DB) | Tag editor in "Edit details", chips on cards, `#tag` search in the app and in Postgres. See K |
| DV-035 | Version history | Missing | Unverified | "Version history" in the file menu: list, download, restore, delete, upload a new version. Drive calls unit-tested; not run against a live Drive. See K |

### Viewers

| ID | Feature | Before | Now | Evidence |
|---|---|---|---|---|
| DV-036 | PDF, virtualized for large files | Verified | Verified | Pages 1/50/400 open on page 1 in 0.8–1.4 s; at most 5 pages rendered |
| DV-037 | PowerPoint opening at slide 600 | Fixed earlier | Verified | 1,200-slide merged deck opens on slide 1 in 275 ms |
| DV-038 | PowerPoint slideshow, transitions and animations | Verified | Verified | Slideshow and animation checks pass |
| DV-039 | Word (.docx) | Verified | Verified | Colours changed from blue/slate to the warm palette |
| DV-040 | Spreadsheets | Partial: .xls went through the Drive preview only; .ods and .tsv had no preview | Verified | xlsx, xls, ods, csv, tsv read locally (unit tests on the real renderer) |
| DV-041 | Text formats (md, json, xml, log, yaml, rtf, scripts, .url) | Partial: only plain text; json, md and xml showed "Preview unavailable" | Verified | Chrome format check |
| DV-042 | Text viewer safety | **Broken: stored XSS**. File text was inserted as HTML. | Verified | Text is escaped; Chrome check opens a hostile file and nothing runs |
| DV-043 | Audio and video | Missing | Verified | Built-in player; Chrome check plays a WAV |
| DV-044 | ZIP listing | Missing | Verified | Lists contents without extracting anything |
| DV-045 | .doc, .ppt, .odt, .odp, .tiff | Partial | Unverified | Google Drive preview; needs a signed-in check |
| DV-046 | EPUB | Missing | Verified | Built-in reader with contents and chapters; Chrome check at desktop and phone width |
| DV-047 | Programs and shortcuts (.exe, .lnk) | Partial | Verified | Safe fallback that states they are never run |

### Security, UI and quality

| ID | Feature | Before | Now | Evidence |
|---|---|---|---|---|
| DV-048 | Companion security | Missing | Verified | Listens on 127.0.0.1 only. Checks Origin, Host header and JSON content type. Protected folders. **8.3 short-name and junction bypass found and fixed** (test added). |
| DV-049 | HTTP security headers | Partial (`nosniff` only) | Unverified | Added X-Frame-Options, Referrer-Policy, Permissions-Policy and a **report-only** CSP; not deployed |
| DV-050 | Drive access token kept in localStorage | Open risk | Accepted risk | Kept for at most 55 minutes, by decision; see G |
| DV-051 | White and light-brown UI, no purple, no emoji, responsive | Verified | Verified | Code search finds none; layout check at desktop, tablet and phone sizes, light and dark |
| DV-052 | Automated tests | Partial | Verified | 104 web tests, 47 companion tests, browser checks |

---

## B. Changes made in this round

**New**
- `companion/`: the local indexing service (Node 24, built-in SQLite with FTS5 trigram index), its tests and a README.
- `src/pages/DesktopFiles.tsx` and `src/components/desktop/*`: search page, pairing, indexed folders, local preview.
- `src/services/desktopCompanion.ts` and `src/hooks/useCompanion.ts`: the browser client.
- `src/services/contentIndex.ts`: text extraction, storage in `document_contents`, and content search.
- `src/components/viewer/ArchiveListing.tsx`: ZIP contents listing.
- `supabase/migrations/20261021153836_vault_search_paging.sql`: additive; **not applied**.

**Repaired**
- Text viewer XSS (DV-042).
- Drive validation no longer deletes records (DV-026).
- Validation runs that were interrupted left documents marked as already checked, so they were never checked again. That is fixed.
- Rename keeps the extension (DV-030).
- Companion protected-folder bypass via 8.3 names and junctions (DV-048).
- Companion "Open" used a PowerShell 5.1 flag that does not exist; it now uses `ProcessStartInfo` with `UseShellExecute`.
- Spreadsheet preview emitted a CSP `<meta>` outside `<head>` (console error).

**Improved**
- Format routing for more formats (DV-040 to DV-047).
- Warm colours in Word and spreadsheet previews.
- Preview cache version raised to 3, so spreadsheet HTML cached by older builds is discarded.
- "Edit details" dialog.
- Security headers.

**Left unchanged on purpose**
- Firebase Authentication and Firestore as the system of record.
- The Drive ownership model (`drive.file`).
- The existing `search_documents` function.
- The Firestore rules (not weakened).

---

## C. Desktop search: how it works

**Companion.** Yes, it needs one. Browsers cannot read the disk, so a small local program runs on the PC (`companion/`). Start it with `Start Document Vault Companion.cmd` or `npm run companion`. It listens on `127.0.0.1:47615` only, and answers only the allowlisted site addresses and paired browsers.

**Choosing folders.** Under Desktop Files, choose Indexed folders, then:
- **Add folder** opens the native Windows folder picker.
- **Add path** takes a typed path, after a confirmation dialog.

Windows, Program Files, ProgramData, AppData and the companion's own data folder are refused. This holds even when they are reached through 8.3 short names or junctions.

**Indexing.**
- One background scan per folder, in batches, so search stays fast while indexing.
- Each scan stamps the rows it sees. Rows not seen by the latest scan are removed.
- Between scans, Windows change notifications (`fs.watch`, recursive) update single paths within about 0.4 s.
- Only names, paths, sizes, dates and types are indexed. File contents are not read.
- Measured: 30,000 files indexed in 12.2 s, an unchanged rescan in 4.5 s, a 31 MB index, and 125 MB of memory.

**Storage.**
- A SQLite database in `%LOCALAPPDATA%\DocumentVault Companion`, with an FTS5 trigram index on names and paths.
- Nothing is sent to Firebase, Drive or Postgres.

**Search.**
- Whole and partial words; short words match within names.
- A typo-tolerant pass runs when nothing matches exactly.
- Ranking: exact name, then names starting with the query, then names containing all words, then path matches.
- Measured over 30,000 files: 0.6–1.2 ms for typical queries, 72–84 ms for very broad ones.

**Opening.**
- **Open** hands the file to Windows' default program.
- Programs, scripts and shortcuts (50 extensions) are never opened.
- **Show in folder** opens Explorer with the item selected.
- **Preview** streams the file to the browser for viewing. Nothing is uploaded.

**Moved or deleted files.**
- Change notifications update the index.
- Opening a stale result returns "This item was moved or deleted. The index has been updated.", and the row is removed.
- A disconnected drive keeps its entries and is reported as unavailable.

**Limitations.**
- Windows only.
- The companion must be running.
- Text inside local files is not searched; only names and paths are.
- On this PC, `.txt` files are associated with the Store Notepad, which shows Windows' "Open with" dialog for every launch method. That is a machine setting, not an app bug.
- A file-change update still in progress at shutdown is not awaited. This is low impact, since it only affects the companion while it is exiting.

---

## D. Database and storage

**Postgres (Supabase).** It mirrors Firestore metadata for search; Firestore stays the system of record.

Migrations:
- `20261021114122_vault_core.sql` (applied): profiles, folders, documents, document_contents, collections and audit_events, all with row-level security keyed to the Firebase uid via `private.current_uid()`.
- `20261021114131_vault_search.sql` (applied): `search_documents` with ranked full-text and trigram search.
- `20261021153836_vault_search_paging.sql` (**not applied**): adds the `drive_missing` column and `search_documents_page` with offset paging, a total count, the folder path and excerpts. It is additive only.

The browser uses only the publishable key, and each request carries the Firebase ID token. No secret or service-role key is in browser code.

**Firebase.** Google sign-in and Firestore are unchanged. The rules remain owner-only. The record's new field `driveMissing` is written by the owner's client, which the current rules allow.

**Google Drive.**
- Files stay in each user's own Drive (`drive.file` scope).
- Validation now lists the app's files in batches of 1,000.
- A file absent from that listing is checked individually before being flagged.
- A file is flagged only if it was uploaded more than 5 minutes ago.
- Nothing is deleted automatically.
- Drive's trash state is synced to the record.

---

## E. Document viewers

| Format | How it is shown |
|---|---|
| PDF | Built-in viewer: virtualized pages, zoom, page jump |
| DOCX | Converted to HTML in a sandboxed frame |
| XLSX, XLSM, XLS, ODS, CSV, TSV | Table per sheet, read locally |
| PPTX | Built-in slide viewer, slideshow, transitions and animations |
| TXT, MD, JSON, XML, LOG, YAML, INI, scripts, `.url` | Plain text with find; markup is shown, never run |
| RTF | Readable text; formatting dropped (limited) |
| HTML | Sanitized, sandboxed frame |
| PNG, JPG, GIF, WEBP, SVG, BMP | Image with zoom |
| MP3, WAV, OGG, M4A, FLAC, MP4, WEBM, MOV | Built-in audio or video player (depends on browser codec support) |
| ZIP | List of contents with sizes; never extracted |
| DOC, PPT, ODT, ODP, TIFF, HEIC | Google Drive preview (limited; needs to be online) |
| EPUB | Download only (no preview) |
| EXE, MSI, LNK and other programs | Not previewed or run; download only |
| Anything else | Safe "cannot be shown here" panel with Download |

Local files under Desktop Files use the same renderers for PDF, Word, Excel, PowerPoint, text, images, audio and video, streamed from the companion.

---

## F. Performance

Measured in Chrome on this PC:

| What | Result |
|---|---|
| PowerPoint, 1,200-slide merged deck, first slide | 275 ms; opens on slide 1 |
| PowerPoint, 1,000 slides | Next slide 38 ms, jump 173 ms (earlier run) |
| PDF, 1 / 50 / 400 pages, first page | 1.4 s / 0.8 s / 1.4 s; at most 5 pages rendered; heap about 60 MB |
| Local search over 30,000 files | 0.6–1.2 ms typical, 72–84 ms for broad queries |
| Typing in Desktop Files | Debounced to 180 ms; earlier requests cancelled; no long tasks measured |
| Text extraction, 400-page PDF | 2.5 s in the background, longest frame 38 ms |
| Text extraction, 1,000-slide deck | 0.9 s, longest frame 42 ms |
| Drive validation | One listing per 1,000 files instead of one request per file |

---

## G. Security

**Fixed in this round**
1. **Stored XSS in the text viewer** (high). A text, CSV or Markdown file containing `<img onerror=…>` ran script in the app's origin, where the Drive access token is stored. The text is now escaped, and a test opens a hostile file in Chrome. **This bug is in committed code, so the live site is very likely affected until this branch is deployed.**
2. **Companion protected-folder bypass** (high). Windows 8.3 short names and junctions could reach AppData. Paths are now resolved with `realpath` before the check, and a test covers it.
3. Data loss: automatic deletion of records whose Drive files could not be found was removed.
4. Added X-Frame-Options, Referrer-Policy, Permissions-Policy and a report-only CSP.
5. Content search: a database row for a document not in the visible library is never shown, and excerpts are rendered as text, not HTML.

**Decisions taken**
1. **Drive token storage: kept in `localStorage`, for at most 55 minutes.** Google's access token lasts one hour; the app drops it 5 minutes early and on sign-out. Keeping it only in memory would ask Google again on every page load and every new tab, and the browser blocks that pop-up when it does not follow a click. The main way to steal it was script injection, and the known injection (the text viewer) is fixed; documents shown in frames (EPUB, Word, HTML) are sanitised and sandboxed, and the CSP is in place in report-only mode. The token only grants `drive.file`, which reaches files this app created, not the rest of the user's Drive. Revisit this if the CSP is enforced and a token-in-memory flow becomes worth the extra prompts.
2. **Firestore field allow-list: done.** `firestore.rules` lists every field the app writes and checks each field's type and size (tags at most 20, hash 64 hex characters, version a whole number of at least 1). Records written by the deployed app still pass. 10 emulator tests (`npm run test:rules`).
3. **`vercel.json`: fixed.** `routes` was replaced by `rewrites`, which may be combined with `headers` and `trailingSlash`. The OCR files under `/ocr/` are cached for a week. The report-only CSP allows `'wasm-unsafe-eval'`, which the OCR engine needs.

**Remaining concerns**
1. The CSP is report-only. Once it runs on the real site without violations in the console, it can be switched to enforcing.
2. **The new rules and the new app must be deployed together.** The new app writes `tags`, `contentHash` and `version`. The rules currently live do not reject unknown fields, so the new app also works under the old rules, and the new rules accept the deployed app's records (tested). Deploy the rules with this branch, never long before or after.

---

## H. Testing

| Suite | Result |
|---|---|
| `npx tsc -b` | Clean |
| `npx eslint .` | Clean |
| `npx vitest run` (13 files, including live DB policy tests in rolled-back transactions) | **104 / 104 pass** |
| `npm run build` | Succeeds (chunk-size warning only) |
| `npm run test:companion` | **47 / 47 pass** |
| `npm --prefix companion run check:launcher` (real Explorer open and reveal) | Pass |
| Chrome, Desktop Files end to end (pairing, indexing, search, typo, filters, previews, delete, open, phone width) | Pass (earlier this session). Not re-run at the end because your own companion was using port 47615. |
| Chrome, formats (XSS, JSON, RTF, .url, audio, video, ZIP, .exe, .lnk, phone width) | 16 / 16 pass |
| Chrome, text extraction (400-page PDF, 1,000-slide deck) | Pass |
| Chrome, PDF and PowerPoint viewer, slideshow, animations | Pass |
| Chrome, layout at 3 sizes, light and dark, including `/desktop`; trash flows | All layout and flow checks pass. The only console errors come from your running companion rejecting the test-only origin `localhost:5199`, which is correct behaviour. |

The browser checks live in the session scratchpad, not in the repository.

**Not verified:** anything that needs a signed-in Google account:
- Drive upload, rename and validation against a real Drive;
- the content index upload path;
- the "Edit details" dialog;
- Drive-preview formats;
- live mirror sync.

The production headers and Firestore rules are also unverified.

---

## I. Remaining work

| Item | What is needed |
|---|---|
| ~~Apply migration `20261021153836`~~ | Done (K). |
| Signed-in verification | Sign in on `npm run dev` (port 5173). Upload a PDF, open it, search for a word inside it under Desktop Files with "Uploaded documents" selected. Also rename a file, edit its details and confirm Drive keeps the extension. |
| ~~Copy file, tags, version history, duplicate detection, EPUB, OCR~~ | Built (K). Copy and version history still need one signed-in check against a real Drive. |
| ~~Token storage and Firestore field allow-list~~ | Decided and done (G). |
| Deploy | Deploy the Firestore rules together with this branch (G, remaining concern 2). |
| Enforce the CSP | After a deploy shows no violations |
| Text search inside local files | **Deferred on purpose.** The companion searches names across whole drives; reading the contents of every local file is a large, slow, privacy-heavy addition the app does not need to work. Uploaded documents are already searchable by content, including OCR. |
| Old dependency advisories | `npm audit` reports 8 issues, all from dependencies that were already there (firebase's `@grpc/grpc-js`, mammoth's `sprintf-js`, `xlsx`). None come from this work. `xlsx` has no fixed release on npm; replacing it is a separate change. |
| ~~`%LOCALAPPDATA%\extract.mjs`~~ | Resolved: it was an empty scratch file from this work and has been deleted. |

## J. Opening speed and upload reliability (21 October 2026)

### Causes found

| Problem | Cause |
|---|---|
| Uploads of large files restart from zero after any interruption | Every file was sent in one multipart request; a dropped connection, a 503 or an expired token lost everything sent so far |
| A short connection drop fails the whole batch | Network errors used up a file's 4 attempts within about 15 s, then the queue moved to the next file and failed that too |
| Queue lost on refresh | Only file names were saved; contents were gone, so every unfinished file failed with "File content is unavailable" |
| No resume after reconnecting Drive | After an expired token, uploads stayed paused until "Continue upload" was pressed |
| Retries sent duplicates | A Firestore write whose reply was lost was written again as a new record |
| Large folders slow | One file at a time; each small file costs three round trips |
| Queue writes slow down big batches | The whole queue was serialised to localStorage on every state change; a full storage threw inside the upload loop |
| Drive-preview formats (.doc, .ppt, .odt, .tiff) open slowly | The whole file was downloaded before Drive's own preview was shown, and the preview does not need it |
| Extra wait on every Office or text file | A metadata request ran before each download even when the type was known |
| Every download written to IndexedDB twice, without a size limit | Two save calls; no cap |
| Document reloads while open | The viewer restarted its download whenever the app re-rendered (a new callback each render) |
| Opening waits on Firestore | The "last viewed" write was awaited before the viewer opened, and never finished offline |
| Endless "Opening document..." | With no Drive token the viewer waited for ever; no download progress was shown |

### Changes

- Files over 5 MB upload through Drive resumable sessions in 8 MB chunks. The session address and the bytes stored are saved, so a retry, a reconnect or a reload continues from the last chunk Drive confirmed. Smaller files still use one request.
- A lost connection pauses the whole queue (the browser's offline event stops running uploads at once) without using up attempts. The queue checks Google every 2–30 s and on the browser's online event, then resumes by itself.
- An expired token pauses the queue; it continues by itself when Drive is reconnected.
- Files waiting to upload are copied to IndexedDB (up to 2 GB per batch), removed as each one finishes, and all removed at sign-out. After a reload the queue continues on its own. Files whose copies are missing are marked "add again" (not failed); re-adding the same files or folder continues them, and finished files are skipped.
- Records are written with the queue item's id, so a retry after a lost reply rewrites the same record. Firestore rules are unchanged; create and owner update were already allowed.
- Up to three files upload at once. Concurrent uploads share one lookup of the vault folder, so it is never created twice.
- Queue saves are batched (every 0.4 s, and immediately when the page is hidden or closed); storage errors no longer stop uploads.
- Drive rate-limit errors (403 rateLimitExceeded) are retried with backoff; a full Drive gets its own message.
- The dialog and the sidebar show paused, offline, retrying and "add again" states, with progress kept for paused files.
- Viewer: download progress ("Downloading 1.2 MB of 4.0 MB (30%)" with a bar), cancelled when another document is opened; Drive-preview formats open at once; no metadata request when the type is known; one offline-cache write per download, skipped above 100 MB; documents cached in this browser open without a Drive token; with no token and no cache it says so and offers Reconnect; network failures get a plain message.
- Opening no longer waits for the "last viewed" write.
- The slide engine loads separately from the main bundle, fetched when the browser is idle.

### Tests

- `src/hooks/useUploadQueue.test.tsx` runs the real queue and Drive client against a fake Drive that implements the resumable protocol. Cases: small and large files byte-exact, one upload each; connection dropped mid-chunk then restored (only the lost chunk is resent, one session); expired token then reconnect (resumes by itself); reload mid-upload (continues the stored session); lost file copies then re-added; lost Firestore reply (one record); existing document skipped; 300 files in nested folders at 40 ms per request (about 9 s, never more than 3 at once; one at a time would take over 36 s).
- `src/services/googleDrive.test.ts`: download progress with and without a length; network errors told apart from Drive errors.
- `src/services/documentViewer.load.test.ts`: Drive-preview formats make no request; cached copy opens without a token; no token and no cache gives a clear error.
- Browser (Chrome, harness): a 400-page PDF at 64 KB/s shows advancing progress and opens; switching documents mid-download shows the new one; no token shows the message and Reconnect; earlier format, slideshow, animation, viewer and layout checks still pass.

Not tested against the real Google Drive: automation cannot sign in to Google. The fake follows Google's documented protocol (Location header, 308 with Range, `bytes */size` status queries). Before relying on it, upload one file over 5 MB, turn Wi-Fi off mid-upload, turn it back on, and confirm the file in Drive opens.

Measured in the harness: the 1200-slide deck opened in 641 ms when opened immediately after page load, against 275 ms before. The slide engine had not been pre-fetched yet. In normal use the idle pre-fetch has run by the time a deck is opened.

---

## K. Copies, tags, versions, duplicates, EPUB and OCR (21 October 2026)

### What was built

- **Make a copy.** In each file's menu. Drive copies the file into the same folder ("Name (copy).ext", then "(copy 2)" and so on), and a new record keeps the category, description, tags and folder. The copy's searchable text is copied too, so it does not need re-reading.
- **Tags.** Up to 20 per file, at most 40 characters each, stored lower-case with spaces turned into hyphens. Edited in "Edit details" (Enter or comma adds, Backspace removes, suggestions from tags already used). Cards and rows show up to three. In search, `#tax` must match a tag exactly; plain words also match tags. Postgres search follows the same rules.
- **Version history.** In each file's menu. Lists the versions Drive keeps, newest first, with download, restore, delete and "Upload new version". Nothing is overwritten:
  - uploading a new version keeps the file's id and link, and pins the previous version;
  - restoring an old version uploads it again as the newest version.

  Drive deletes unpinned versions after 30 days and allows at most 200 pinned versions per file, so at 199 the oldest pinned one is unpinned. Cached previews, thumbnails and offline copies are dropped when the version changes, on this device and on others.
- **Duplicate detection.** Every upload is hashed (SHA-256, up to 150 MB, in the browser). If the vault already has a file with the same contents, under any name or folder, the upload pauses with "Already in your vault as …" and the choice "Skip" or "Upload anyway", per file or for all. Older records get their hash filled in when opened.
- **EPUB reader.** Chapters, table of contents (EPUB 3 and EPUB 2), previous and next, and remembers the last chapter per book. Each chapter is shown in a sandboxed frame with scripts removed and pictures embedded, so a book cannot run code or load anything from the internet.
- **OCR (text in pictures and scans).** Free and in the browser (Tesseract.js 7, English). Nothing is sent to any service, and the engine and language files are served from this site under `/ocr/`. It runs for pictures, and for PDFs with almost no text layer (up to 30 pages), one at a time in the background. The engine shuts down after a minute idle. Settings has an on/off switch (on by default). The first use downloads about 7 MB, which is cached afterwards.
- **Database.** Migration `20261021153836_vault_search_paging` was dry-run, then applied: `documents.drive_missing`, `documents.tags` (limit enforced by a check constraint, GIN index) and `search_documents_page` (paged, ranked search with tag rules). It is additive; nothing was dropped or rewritten. The mirror now sends `tags` and `drive_missing`.

### Tests

| Check | Result |
|---|---|
| `npx tsc -b`, `npx eslint .` | Clean |
| `npx vitest run` (includes live DB tests in rolled-back transactions) | **141 pass**, 10 skipped (the rules tests, which need the emulator) |
| `npm run test:rules` (Firestore emulator) | **10 / 10** |
| `npm run test:companion` | **47 / 47** |
| `npm run build` | Succeeds; `/ocr/` files emitted |
| Chrome: OCR on a PNG and on an image-only PDF | Both read "CERTIFICATE OF COMPLETION … Kingsley Anaab …"; no requests to other sites |
| Chrome: EPUB at 1280 px and 390 px | Text shows, next chapter works, no sideways scrolling, no errors |
| Chrome: OCR switch in Settings | Saves and survives a reload |

New or extended test files:
- `contentIndex.ocr.test.ts`;
- `epub.test.ts`;
- `fileHash.test.ts`;
- `tags.test.ts`;
- `metadataMirror.test.ts`;
- `googleDrive.test.ts` (copy and version requests);
- `useUploadQueue.test.tsx` (duplicate by contents: ask, upload anyway, skip);
- `tests/db/policies.test.ts` (tag search, tag limit).

The harness pages are `tests/harness/ocr.html` and the existing viewer harness.

**Not verified:** copy, version history (list, restore, upload new version) and tag editing against a real signed-in Drive and Firestore, since automation cannot sign in to Google. Before relying on them, do the following signed in:
1. Copy a file.
2. Add a tag and search `#thattag`.
3. Upload a new version of a PDF, open it, then restore the first version.
4. Upload the same file again under another name and confirm the duplicate prompt.

## L. Background preparation, fast opening and scroll stability (21 October 2026)

### What was built

- **Background preparation.** Every upload, every new version and every document opened is queued to be prepared in the browser. A few favourite and recently used documents are also queued each visit. Prepared means:
  - **PDFs:** page count, every page's size, and pictures of the first 3 pages (WebP, at the width the viewer shows them).
  - **PowerPoint decks:** the slide count and the first 3 slides as data, with the pictures they use (up to 4 MB).
  - **Word, spreadsheets, text and web pages:** converted as opening them would.

  The queue is stored in IndexedDB (`previewMeta`), so it carries on after a reload or restart; a job that was running when the tab closed goes back to the queue. Other rules:
  - one job at a time, when the browser is idle; nothing is prepared while a document is open;
  - priority: uploads, then opened documents, then the per-visit picks (at most 25 a visit, files up to 40 MB, none when the browser asks to save data);
  - each file has one job at a time, and a job whose file was already prepared at the same version is skipped;
  - up to 3 attempts with growing waits; a missing Drive connection or network waits instead of failing;
  - limits of 300 MB for PDFs and 100 MB for other files; anything bigger is marked "opens from Google Drive" and is not processed;
  - an embedded or unknown format is marked unsupported instead of failing.
- **Status.** Cards and rows show Queued, Preparing, Ready, Partly ready, Waiting or Preview failed. Settings has "Fast opening on this device" with:
  - counts and space used;
  - the failures, each with "Try again";
  - a choice between preparing recent files or only uploads and opened files;
  - a two-step "Remove prepared copies…".
- **Opening.**
  - **PDFs:** the layout is computed from the stored page sizes and the stored pages show at once, while the file is still being read or downloaded.
  - **Decks:** the stored first slides show the same way. The slideshow becomes available once the file has loaded.
  - **Freshly drawn pages:** they show straight from the canvas and are compressed only when the browser is idle.
  - **Reading position:** documents still open at page or slide 1; the resume banner only offers the last position.
- **Scrolling no longer moves by itself.** Each page's box is computed from its size in the PDF before anything is drawn, so drawing never changes the layout. When the layout does change (sizes read later, zoom, window width), the page at the top of the view is kept in place. Page cards no longer grow beyond their picture on narrow screens.
- **Drive reconnects on click.** Clicking a document while Drive is disconnected starts Google's sign-in straight away, with your account already filled in, unless the document is stored on the device.

### Privacy, access and storage

- Prepared copies never leave the device. They are kept in this browser's IndexedDB, like the existing offline copies, and there is no server, service worker cache or shared storage involved.
- Everything is tied to the file id and version. A new version, or a restore, ignores the old pictures and prepares again.
- When the signed-in library no longer lists a file, everything stored for it is removed: deleted, moved to another account, or no longer accessible. This happens only from a complete list from the server, never a partial or cached one. Sign-out clears it all.
- The space limit is the smaller of 2 GB and 30% of what the browser allows, or 500 MB when the browser does not say. Over the limit, the least recently used originals are removed first, then pictures; the open document is never removed.
- Files are only read, never run. pdf.js has XFA forms off, PowerPoint decks are parsed as XML, and macros are never executed.
- Another device prepares its own copies. Nothing assumes a preview made elsewhere.

**Options that need your approval (not built):**
- Preparing on a server, so even the first open on a new device is instant. This needs Cloud Functions or another paid compute service.
- Sharing prepared pages between devices. This needs new production storage, such as Firebase Storage or Drive app data, plus access rules.

Both change cost and where copies of your documents live.

### Timings

The test machine ran Chrome at 1440 × 900. "First visible" is the time from choosing the file to its first page or slide on screen. The simulated Google Drive runs at 1 MB/s. The figures are from the development server without React StrictMode, whose doubled effects only exist in development.

**Before** (earlier working tree):

| File | From Drive | On device |
|---|---|---|
| PDF, 1 page | 1435 ms | 864 ms |
| PDF, 400 pages | 1978 ms | 1431 ms |
| Deck, 500 slides | 1449 ms | 883 ms |
| Deck, 1,200 slides | 2475 ms | 888 ms |

**After:**

| File | Not prepared, from Drive | Not prepared, on device | Prepared, original from Drive | Prepared, on device | Preparation took |
|---|---|---|---|---|---|
| PDF, 1 page | 862 ms | 942 ms | **90 ms** | **103 ms** | 0.75 s |
| PDF, 400 pages | 1450 ms | 888 ms | **80 ms** | **106 ms** | 1.2 s |
| PDF, 400 mixed-size pages | 1414 ms | 917 ms | **128 ms** | **97 ms** | 1.0 s |
| Deck, 500 slides | 1432 ms | 904 ms | **317 ms** | **173 ms** | 0.08 s |
| Deck, 1,200 slides | 2427 ms | 894 ms | **239 ms** | **165 ms** | 0.1 s |
| Deck, 1,500 slides | 2471 ms | 887 ms | **231 ms** | **197 ms** | 0.13 s |

Every case opened at page or slide 1.

**Scroll stability, before:** after jumping to page 200, the page at the top slid from 199 to 184 within 3 s. At phone width, a page card was 1273 px tall around a 526 px picture.

**Scroll stability, after:**
- After jumping to page 200 (uniform and mixed page sizes, including while the original was still downloading), page 200 stays at the top for 3 s.
- After scrolling with the mouse wheel or in small trackpad-like steps, the view does not move once you stop.
- At phone width, the card is the picture plus its 32 px header.

### Tests

| Check | Result |
|---|---|
| `npx tsc -b`, `npx eslint .` | Clean |
| `npx vitest run` | **168 pass**, 10 skipped (the rules tests, which need the emulator) |
| `npm run build` | Succeeds; deck code stays in its own on-demand chunk |
| Chrome: new Settings section at 1280 px and 390 px | Renders, no sideways scrolling, no errors |

New test files:
- `src/components/viewer/pdfLayout.test.ts` (6 tests): layout from page sizes, finding the page at an offset, keeping the place when sizes, zoom or width change.
- `src/services/previewQueue.test.ts` (21 tests), covering:
  - batches;
  - priority;
  - one job per file;
  - recovery after a restart;
  - new versions;
  - retries and failure;
  - waiting for Drive or the network;
  - cancelling;
  - size limits and unsupported formats;
  - removal when a file leaves the library, while never pruning from a partial list or losing a fresh upload;
  - the storage limit;
  - deck snapshots, including their removal.

The viewer harness (`tests/harness/viewer.html`) takes these options:
- `?prepare=1` prepares the file as an upload would, then opens it;
- `&dropOriginal=1` also removes the stored original, so it downloads again;
- `?strict=0` renders without StrictMode.

**Not verified:** preparation and the click-to-reconnect sign-in against a real signed-in Google account, since automation cannot sign in to Google. Google may still show its consent screen when the Drive permission has expired. Before relying on it, do the following signed in:
1. Upload a PDF and a deck, and watch the badge go from Queued to Ready.
2. Reload and open both; the first page or slide should appear at once.
3. Disconnect Drive, then click a document that is not stored on the device; the Google sign-in should open straight away.

### Fix: documents stuck on "Opening document..."

The on-device store moved to version 2 of its database. A tab still running the previous build, or the same tab before a hot reload, kept version 1 open. The upgrade then waited for that connection, and every document open waited with it.

The fix has three parts:
- The store now gives up at once when the upgrade is blocked, and the document opens from Google Drive. The upgrade completes as soon as the old connection closes.
- Opening a document also pauses any background preparation that is downloading from Drive, so the two do not share the connection. The paused job goes back to the queue without counting as a failed attempt.
- Tests: `offlineStore.blocked.test.ts` and a new case in `previewQueue.test.ts`.

## M. Local law libraries: authorized folders, full-text search, book links (23 October 2026)

All of this is in the desktop app's local companion and the workspace pages that use it. Nothing is uploaded; the index and extracted text stay in the companion's data folder on the computer.

| ID | Item | Before | Now | Evidence |
|---|---|---|---|---|
| DV-053 | Libraries (named, authorized folders with settings) | Missing | Verified | Add, rename, subfolders and depth, file types, pause, resume, clear, remove. `companion/test/libraries.test.js` |
| DV-054 | Exclusions | Missing | Verified | An excluded subfolder leaves search, lists and links at once and returns when included again |
| DV-055 | Revoke and grant access again | Missing | Verified | Revoked libraries are absent from search, lists and evidence; text read during revocation is discarded (per-library epoch); granting again needs the same folder |
| DV-056 | One enforcement point | Missing | Verified | `companion/src/access.js` (`scopeSql`, `checkReal`) is used by search, tree, health, links, preview, open and evidence |
| DV-057 | Text extraction (PDF with pages, DOCX, EPUB, PPTX, HTML, TXT, RTF) | Missing | Verified | Worker threads with memory, time and size limits; damaged and slow files recorded as failed with a reason; unchanged files not read again; PowerPoint slides read in deck order |
| DV-058 | Full-text search with page numbers and excerpts | Missing | Verified | FTS5 (porter, unicode61). Ranking: exact title, file name, phrase, text, metadata, fuzzy name. Phrase, OR and minus syntax |
| DV-059 | Metadata and corrections | Missing | Verified | Titles and authors from the files; user corrections are kept and never overwritten |
| DV-060 | HTML catalog links | Missing | Verified | Found, broken, not indexed, outside, web link; links outside the libraries never followed, web links never fetched, scripts never run or indexed |
| DV-061 | Library Health | Missing | Verified (server), Unverified (UI) | Inaccessible, failed, broken and outside links, needs OCR, truncated, waiting, skipped with reasons, exact duplicates (listed only, never deleted) |
| DV-062 | Index migrations and recovery | Missing | Verified | `pragma user_version`, copy of the old file before upgrading, refuses a newer index, moves a damaged index aside and rebuilds |
| DV-063 | Opening allowlist, shortcuts and junctions | Partial | Verified | Allowlist of document types; shortcuts to network locations or outside the libraries refused; junctions out of a library not followed |
| DV-064 | Desktop CSP and allowed origins | Missing | Verified | Enforced CSP naming the companion port; development origins only in development builds. `desktop/test/static-server.test.cjs` |
| DV-065 | Evidence for a future assistant | Missing | Verified (no model connected) | `companion/src/evidence.js` returns short authorized passages with library-relative locations, never full paths. No AI feature calls it; Library access shows "AI search: off" |
| DV-066 | Workspace pages: My Libraries, library detail, Search, Library access | Missing | Unverified | Type-checked, linted and unit-tested (`src/pages/Search.test.tsx`); not clicked through, because the workspace needs Google sign-in |
| DV-067 | Open a PDF at the matching page, step between matches | Missing | Unverified | `PdfViewer` `goToPage`, `LocalPreview` match bar; not exercised in a signed-in window |

### Measured performance

`companion/scripts/bench.js`, on a generated library of 3,000 text and web files plus 300 PDFs of 30 pages (9,000 pages). Machine: i7-10510U, 8 threads, 16 GB, Windows 11, Node 24.11.1.

| Measure | Result |
|---|---|
| Name indexing | 3,300 files in 4.9 s (677 files/s) |
| Text reading | all 3,300 documents (9,000 PDF pages) within 60 s of adding the library, 0 failed |
| Search, Everything | p50 560 ms, p95 649 ms (was 2,860 / 3,069 ms before the passage lookup fix) |
| Search, Full text | p50 361 ms, p95 497 ms (was 1,169 / 3,095 ms) |
| Search, Titles and names | p50 20 ms, p95 29 ms |
| Index size | 21 MB |
| Memory | 59 MB before adding the library, peak 360 MB including text-reading workers |

Times are over HTTP with result details. Searches for very common words in this vocabulary match 2,000 documents; real libraries with more varied text should match fewer.

### Windows run of the MacBook checklist (23 October 2026)

A script drove a separate instance of the local service over HTTP, as the app does, against a generated library in a temporary folder (deleted afterwards). 25 of 25 checks passed:

1. Adding a library: indexed, no Permission needed.
2. Restarting: the library stays ready and searchable.
3. A phrase finds the book with page 3 and the passage.
4. Exclude and include a subfolder.
5. Catalog links classified (found, broken, outside, web); the catalog's script is not indexed; the book shows which page refers to it.
6. Revoke hides everything. Granting access with a different folder is refused; with the same folder, search is restored.
   - 6b. Folder made unreadable (Windows permissions standing in for macOS): Permission needed, index kept; it recovers after access is granted again.
7. Show in folder opens Explorer at the file.
8. Library folder disconnected: Not available, index kept; it recovers when reconnected.

The original files were untouched throughout.

Found and fixed during the run: excluding a folder by a path through a mapped drive or link was refused, because libraries are stored by their real path. The app itself excludes by folder id, so it was not affected. The path is now resolved first (new test in `libraries.test.js`).

Not covered: the clicks in the signed-in window, and the PDF viewer landing on the page (the service returns the right page; the viewer was not opened).

### Not verified

- Anything on macOS: the folder window, Permission needed after access is withdrawn, Finder reveal, external drives.
- The workspace pages in a signed-in window, on any system.
- OCR of scanned PDFs: built in Round 2, see section N.

## N. Text recognition (OCR) of scanned books in local libraries (23 October 2026)

Scanned pages (pictures, no text layer) in a library can now be searched by their words. Recognition runs in the companion on the computer: Tesseract.js 7 (LSTM, English data bundled in the app, `4.0.0_best_int`), pages drawn with pdf.js and `@napi-rs/canvas`. Nothing is uploaded or downloaded.

| ID | Item | Before | Now | Evidence |
|---|---|---|---|---|
| DV-068 | Asked once per library | Missing | Verified (server), Unverified (UI) | New libraries are `ask`; nothing is recognised until the owner answers "Recognise text"; "Not now" turns it off. `companion/test/ocr.test.js`, `src/components/library/OcrOffer.test.tsx` |
| DV-069 | Recognised pages searchable with page numbers | Missing | Verified | Stored as pages with `source = 'ocr'` in the same text index; page 2 of a scan is found as page 2; mixed PDFs recognise only their scanned pages; JPEG/PNG scans recognised when images are indexed |
| DV-070 | Marked as recognised text | Missing | Verified (server), Unverified (UI) | `excerpt.source = 'ocr'`; Search shows "Recognised text (OCR)" and "may contain errors"; evidence passages carry `recognised: true` |
| DV-071 | Revoke, exclusion, turning off | Missing | Verified | Revoking stops the current page at once and keeps nothing more; exclusion removes the recognised text; turning off stops recognition and keeps text already recognised |
| DV-072 | Resume and reuse | Missing | Verified | Progress is saved per page; after a restart it continues from the page reached, without repeating pages. Identical copies reuse the recognised text |
| DV-073 | Failures and Health | Missing | Verified (server) | Damaged scans and failed pages listed in Health (`ocr-failed`), low average confidence (below 60%) in `ocr-low-confidence`; a hung page times out (120 s) and is skipped |
| DV-074 | No download of language data | Missing | Verified | With the language folder empty, the document fails with "recognition data is missing" and the folder stays empty |
| DV-075 | Index migration v3 | Missing | Verified | Additive columns only; copy of the old file kept before upgrading |
| DV-076 | Packaging | Missing | Verified on Windows (prepared copy), Unverified (installer, macOS) | `prepare.cjs` installs the native canvas binary, adds both Mac binaries with `--mac`, and leaves out unused engine builds and the larger language copy (companion modules 98 MB). The prepared copy recognised a two-page scan under Electron 44 (Node 24) with network calls blocked on the main thread |

### Measured

`companion/scripts/bench.js --scanned 5 --scanned-pages 10`: 50 dense scanned pages (a heading and 18 lines each, 150 dpi), i7-10510U, Windows 11, Node 24.11.1.

| Measure | Result |
|---|---|
| Recognition speed | 8.5 s per page (423 s for 50 pages), 0 pages failed |
| Average confidence | 95% |
| Peak memory | about 500 MB (process, including the recognition worker) |
| Phrase search in recognised text | found on the right page in 11 ms |

The app tells the owner "about 5 to 10 seconds per page"; a 300-page book takes roughly 30 to 50 minutes on a laptop like this one. Speed on the MacBook is not measured.

### Tests

- Companion: 106 of 106 (12 new OCR tests, migration test extended).
- Desktop: 9 of 9. Web: 231 passed, 10 skipped (OCR chip, note, offer and progress tests added). In one full run, 7 database policy tests failed with a DNS error reaching the database host; re-run on their own, all 12 passed.
- Windows checklist (section M) re-run: 25 of 25.

### Not verified

- macOS: the canvas binaries on Apple Silicon and Intel, recognition speed, the packaged app.
- The Windows installer itself (the prepared files were tested under Electron; the installer was not built or run).
- The OCR offer, progress and settings in a signed-in window.
- Languages other than English, handwriting, TIFF scans (not supported; TIFF files are found by name).
