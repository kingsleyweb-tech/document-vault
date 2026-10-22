# Document Vault desktop app

The Document Vault workspace in its own window for Windows, macOS and Linux,
with Desktop Files (search across folders on this computer) built in. It is
an Electron app that bundles a copy of the website's build and the companion
service from `../companion`.

## How it works

- `src/static-server.cjs` serves the bundled web build at
  `http://localhost:47616` (47617 to 47620 if that port is taken). Google
  sign-in accepts `localhost` as an authorised address; a custom `app://`
  address would not be accepted.
- `src/main.cjs` starts the companion in the same process (port 47615, or any
  free port if another copy already holds it) and opens the window at `/app`.
- `src/preload.cjs` gives the page `window.documentVaultDesktop` (version,
  platform, companion port, pairing code, update check). Nothing else from
  Node or Electron is reachable from the page.
- The window is sandboxed with context isolation and no Node integration. It
  can't leave the app: other links open in the default browser, and pop-ups
  are allowed only for Google and Firebase sign-in.
- Help, Check for updates reads `/releases/latest.json` on the website and
  offers the Downloads page. The app never downloads or runs an installer
  itself.

## Develop

```sh
npm install
npm start          # builds the website once, then opens the app
npm run build:web  # rebuild the bundled website after changing it
npm test
```

The website's `.env` must be filled in, because the bundled build uses the same
`VITE_` values.

## Build installers

Each system's installer is built on that system:

| Command              | Run on        | Produces                                                                    |
| -------------------- | ------------- | --------------------------------------------------------------------------- |
| `npm run dist:win`   | Windows       | `release/Document-Vault-Setup-<version>-x64.exe` (NSIS)                     |
| `npm run dist:mac`   | macOS         | `release/Document-Vault-<version>-arm64.dmg` and `-x64.dmg`                 |
| `npm run dist:linux` | Linux         | `release/Document-Vault-<version>-x86_64.AppImage` and `-amd64.deb`         |

The GitHub workflow `.github/workflows/desktop.yml` runs all three. Start it
by hand from the Actions tab and download the results from the run.

There are no signing certificates yet, so:

- Windows shows a SmartScreen warning ("Windows protected your PC", More info,
  Run anyway).
- macOS builds are signed ad hoc and not notarised. The first time, open the
  app with Control-click, Open, or allow it in System Settings, Privacy &
  Security.

Set `CSC_IDENTITY_AUTO_DISCOVERY=false` when building without a certificate.

If a Windows build fails with `EPERM ... rename ... win-unpacked.tmp`, the
security software is scanning the freshly unpacked files while the build moves
them. This happens in protected folders such as Desktop. Build into a folder
outside it:

```sh
npx electron-builder --win --x64 --publish never --config.directories.output=C:/builds/document-vault
```

## Publish a release

1. Raise `version` in `package.json`.
2. Build every installer and test each one on its own system.
3. Create a GitHub release tagged `v<version>` and attach the installers.
4. Fill in the website's release list from the files you uploaded:

   ```sh
   node scripts/release-manifest.cjs --dir <folder with the installers> \
     --base-url https://github.com/<owner>/<repo>/releases/download/v<version>
   ```

   This updates `../public/releases/latest.json` and writes `SHA256SUMS.txt`
   into the folder; attach that file to the release too. A build whose file is
   missing stays "not yet available" on the Downloads page.
5. Deploy the website. The Downloads page and the apps' update checks read the
   new list.
