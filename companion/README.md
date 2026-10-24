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
- Nothing is uploaded. Previews are streamed straight from your disk to your browser. PDFs, audio and
  video of any size are read a piece at a time, through a link that works only for the paired browser
  that asked for it and stops working when that pairing is removed.
- Older Word (.doc) and RTF documents are shown as their text, and HEIC photos are converted to JPEG,
  inside the same limited worker that reads text for search.

## How a library is indexed

1. **Added.** The library is saved and listed at once, and finding its files starts straight away.
2. **Files found.** Folders are listed one by one and each file's name, type, size and date are
   recorded in small batches. Files can be browsed and searched by name as soon as they are found;
   the app shows how many folders and files have been found so far (counts, not a percentage,
   because the total is not known until every folder has been listed).
3. **Text read.** Once every file has been found, the text inside documents is read in the
   background, then scanned pages are recognised (if you agreed) and copies are compared. Until a
   document's text has been read, search finds it by name only, and says so.

Later scans compare each folder with what is already indexed and write only what changed, so a
check of an unchanged library reads the disk but writes nothing. Changes are picked up as they
happen while Document Vault is open, and a check at start-up catches what changed while it was
closed. Links and junctions are never followed, and excluded folders are never opened.

To measure it on this computer (it generates a test library in `companion/.test-sandbox`):

```
node --disable-warning=ExperimentalWarning companion/scripts/bench-discovery.js --files 10000 --keep
```

Measured on an Intel Core i7-10510U laptop (8 threads, 16 GB, Windows 11, Node 24.11), files
already in the disk cache, with generated libraries of small files. Version 1.2.0 against 1.3.0:

| | 10,000 files | 30,000 files | 100,000 files |
|---|---|---|---|
| All files found | 18.0 s → 7.7 s | 222 s → 29.8 s | did not finish¹ → 140 s |
| Folder opened while scanning (median) | 166 ms → 14 ms | 1,132 ms → 21 ms | → 38 ms |
| Longest pause of the companion (99th percentile) | 286 ms → 127 ms | 2,152 ms → 161 ms | → 228 ms |
| Search by word and type, newest first | 1,041 ms → 31 ms | 2,208 ms → 70 ms | → 180 ms |
| Text of documents read | 76 s → 52 s | not done in 25 min² → 163 s | → 534 s |
| Check again, nothing changed | 5.5 s → 0.7 s | → 2.9 s | → 22.9 s |
| Check again after 150 changes | 10.3 s, count wrong³ → 3.1 s | → 8.5 s | → 48 s |
| Index size | → 29.5 MB | → 79 MB | → 256 MB |

¹ 1.2.0 stopped answering requests about six minutes into the scan. ² Documents that could not be
read were read again and again. ³ 1.2.0 lost a renamed folder when it changed during a check.

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
