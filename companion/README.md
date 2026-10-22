# Document Vault Companion

A small program that runs on your Windows computer and lets Document Vault find,
preview and open files that are already on it, without uploading them.

The Document Vault website cannot read your disk by itself; browsers do not allow it.
The companion reads the folders you choose, keeps a private index of file and
folder names on this computer, and answers search requests from the website.

## Requirements

- Windows 10 or 11
- Node.js 22.13 or newer (`node --version` to check)

Nothing else needs to be installed. The index uses Node's built-in SQLite.

## Start it

Double-click **Start Document Vault Companion.cmd** in this folder, or run:

```
npm run companion
```

from the project folder. A window opens and shows a **pairing code**. Keep the window
open while you use Desktop Files. Close it, or press Ctrl+C, to stop the companion.

## Connect the website

1. Open Document Vault and choose **Desktop Files**.
2. Type the pairing code from the companion window and choose **Connect**.
3. Choose **Add folder** and pick a folder to index, for example Documents or Desktop.

A pairing code works once and expires after 10 minutes. Restart the companion to get a new one.

## What it can and cannot do

- It indexes only the folders you add. Removing a folder from the list removes it from the
  index. The files themselves stay where they are.
- It never indexes Windows, Program Files, ProgramData, your AppData folder or its own data folder.
- **Open** uses the program Windows normally uses for that file type. Programs, scripts and
  shortcuts (`.exe`, `.bat`, `.ps1`, `.js`, `.lnk`, `.url` and similar) are never opened or
  run. **Show in folder** works for every file.
- It listens only on `127.0.0.1` (this computer) on port 47615. It answers only the
  Document Vault website and paired browsers, never other websites.
- Nothing is uploaded. Previews are streamed straight from your disk to your browser.

## Where its data lives

`%LOCALAPPDATA%\DocumentVault Companion` holds the index and the list of paired browsers.
Browser tokens are stored only as SHA-256 hashes. Deleting this folder resets the companion
completely. Your documents are not affected.

## Options

```
node companion/bin/companion.js --revoke-all                    forget every paired browser
node companion/bin/companion.js --allow-origin https://host     also allow another site address
node companion/bin/companion.js --port 47615 --data-dir <path>  change the port or data folder
```

The website expects port 47615. Change it only for testing.

## Tests

```
npm run test:companion          automated tests: indexing, search, security
npm --prefix companion run check:launcher   opens and closes a real Explorer window to check Open and Show in folder
```
