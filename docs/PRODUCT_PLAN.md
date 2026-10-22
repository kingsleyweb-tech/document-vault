# Document Vault product expansion: audit and plan

Branch: `feature/product-website` (21 October 2026). Nothing in this plan is committed, pushed or deployed without approval.

## 1. What exists today (audit)

| Area | Current state |
|---|---|
| Web app | Vite 8, React 19, TypeScript, react-router 7 with `HashRouter`. Every route needs sign-in; visitors who are signed out land on `#/login`. |
| Sign-in | Firebase Auth, Google popup, `drive.file` scope. Any Google account can sign in; each user only sees their own records (Firestore rules are owner-only). The first sign-in creates the user's vault folder in their Drive, so there is no separate registration. |
| Storage | Files live in the signed-in user's own Google Drive (`drive.file`). Metadata is in Firestore (owner-only rules), with a Supabase mirror for search. Local copies and prepared previews live in the browser's IndexedDB. |
| Verified features | See `docs/AUDIT.md`, section A and later. They cover upload (files and folders), folders, categories, tags, favourites, recent, trash and restore, version history, search, OCR, previews (PDF, Word, Excel, PowerPoint, images, text, EPUB, archives), offline copies, fast opening, dark mode and a Windows desktop companion. |
| PWA | `manifest.webmanifest` (start `/`) and `sw.js`. Navigations are network-first and app code is cached. Only same-origin requests are handled, so Drive, Firestore and Supabase data are never cached by the service worker. |
| Desktop | `companion/` is a Windows-only Node service on `127.0.0.1:47615`. It indexes folders the user picks and pairs with the web app through a code. There is no installer and no desktop window. |
| Hosting | Vercel (`documents-vault.vercel.app`). All paths are rewritten to `index.html`; static files are served first. |
| Repository | `github.com/kingsleyweb-tech/document-vault` is public. |

Gaps against the brief:
- there is no public site;
- the hash routes cannot be shared as normal links;
- the whole app (Firebase included) loads for every visitor;
- there is no download centre, documentation, policy pages or installable desktop app.

## 2. Architecture

```
/                public site (lazy chunk, no Firebase)
/features /about /downloads /security /privacy /terms
/documentation[/<article>]
/login /register  sign-in (lazy chunk, loads Firebase)
/app/*           workspace (lazy chunk), protected
```

- `main.tsx` mounts a small root. It picks the experience from the path:
  - `/app` loads the workspace in a `BrowserRouter` with `basename="/app"`, so the workspace's existing links (`/files`, `/folders/…`) keep working unchanged;
  - every other path loads the public site.
- **Old links.** `/#/files` and the like are rewritten to `/app/files` before anything renders; `/#/login` becomes `/login`.
- **Protection.** A signed-out visit to `/app/...` goes to `/login?next=/app/...`. After sign-in the visitor returns there. `next` is only honoured when it starts with `/app`, which prevents open redirects.
- **Styles.** The workspace's stylesheets move from `main.tsx` into the workspace and sign-in chunks. The public site has its own scoped stylesheet: white and warm light brown, near-black text, a deep teal accent.
- **Releases.** `public/releases/latest.json` is the single source of truth for downloads and update checks. An entry without a URL renders as "Not yet available", never as a button.
- **Desktop.** An Electron shell lives in `desktop/` with its own `package.json`. It serves the same web build from a local port (`http://localhost:47616`) and runs the existing companion in-process with a cross-platform folder picker. It pairs automatically.

## 3. Stages

1. Audit and plan (this file).
2. Public site, routing split, navigation and footer, home, features and about.
3. Documentation centre and the security, privacy and terms pages.
4. Download centre and release manifest tooling.
5. Desktop app: Electron, security settings, build config, and a Windows build tested on this machine.
6. PWA: manifest identity, service worker review, install guidance.
7. Performance (bundle split check) and security review.
8. Testing (unit, routes and links in a browser, desktop smoke test) and the release report.

## 4. Decisions that need your approval

| # | Decision | Recommendation | Cost |
|---|---|---|---|
| A1 | Where the installers are hosted | GitHub Releases on the existing public repository. Google Drive shows a virus-scan page for files over about 100 MB, which breaks direct links, checksums and update checks. Drive also needs per-file public sharing, which you said must not happen without approval. | Free |
| A2 | Building for macOS and Linux | A GitHub Actions workflow (`.github/workflows/desktop.yml`), run on demand. It needs the branch pushed. This Windows machine cannot build or test macOS. | Free for public repos |
| A3 | macOS signing and notarisation | Apple Developer Program. Without it, macOS shows "cannot be opened" until the user chooses Open Anyway. | $99 / year |
| A4 | Windows code signing | Optional. Without it, SmartScreen shows "Windows protected your PC" until the user chooses Run anyway. | About $200–400 / year, or Azure Trusted Signing at about $10 / month |
| A5 | A public contact address | Not published until you choose one. `/contact` is left out until then. | None |
| A6 | Deploying to Vercel, committing, pushing | Only on your word. | None |
| A7 | Legal text | The privacy and terms pages are plain-language drafts and are marked for legal review. | None |
| A8 | Enforcing the Content Security Policy | `vercel.json` sends it as `Content-Security-Policy-Report-Only`, so nothing is blocked yet. Watch the browser console on the live site for a few days, then switch the header name to enforce it. | None |

## 5. Results (21 October 2026)

Checked on this Windows 11 machine:

- `npm run build`, `npx tsc -b` and `npx eslint .` succeed with no errors.
- `npx vitest run`: 181 tests passed, 10 skipped.
- `npm test` passes in `companion/` (47 tests) and in `desktop/` (4 tests).
- A browser crawl of all 15 public pages at 1440 px and 390 px found no console errors, sideways scrolling, dead internal links or missing anchors, and no Firebase requests. The `/app`, `/app/...` and legacy `#/` addresses redirect to sign-in with the destination kept.
- Windows installer: `Document-Vault-Setup-1.0.0-x64.exe` (NSIS, about 121 MB, unsigned) was built. The packaged app was tested with a separate profile:
  - The window is sandboxed with context isolation, and the page has no Node or IPC access.
  - The bridge exposes 6 keys.
  - The companion pairs and answers, using a fallback port when 47615 is taken.
  - Navigation away from the app and unknown pop-ups are blocked.
  - The Google sign-in pop-up reaches Google's page and has no bridge.
  - The installer itself was not run, to avoid adding shortcuts and an uninstall entry to this machine.

Not verified:

- The macOS and Linux builds, which need the CI workflow (A2) or those machines.
- A full Google sign-in inside the desktop app.
- Live Drive operations from the desktop app.
- The PWA install prompt on a phone.
