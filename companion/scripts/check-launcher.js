// Manual check of the real Windows launcher (npm run check:launcher). Opens a
// temporary folder (handled by File Explorer on every Windows PC) whose name
// contains shell metacharacters, confirms the window appears, then closes only
// that window. Repeats for "Show in folder".
import { openWithDefaultApp, revealInExplorer } from '../src/launcher.js'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dv-open-')))
const folder = path.join(dir, process.argv[2] ?? "Launcher check [1] $(whoami) ; & 'x'")
fs.mkdirSync(folder)
fs.writeFileSync(path.join(folder, 'inside.txt'), 'probe')

const ps = (script, env = {}) =>
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', env: { ...process.env, ...env } }).trim()
const windowsAt = (target) =>
  Number(ps("@((New-Object -ComObject Shell.Application).Windows() | Where-Object { $_.Document.Folder.Self.Path -eq $env:DV_T }).Count", { DV_T: target }))
const closeAt = (target) =>
  ps("(New-Object -ComObject Shell.Application).Windows() | Where-Object { $_.Document.Folder.Self.Path -eq $env:DV_T } | ForEach-Object { $_.Quit() }", { DV_T: target })
const wait = async (test) => { for (let i = 0; i < 40; i++) { if (test()) return true; await new Promise((r) => setTimeout(r, 250)) } return false }

let ok = true
await openWithDefaultApp(folder)
const opened = await wait(() => windowsAt(folder) > 0)
console.log(opened ? `ok   open: File Explorer window opened at the folder (${path.basename(folder)})` : 'FAIL open: no Explorer window')
ok &&= opened
closeAt(folder)
const closed = await wait(() => windowsAt(folder) === 0)
console.log(closed ? 'ok   closed the window the test opened' : 'FAIL window still open')

await revealInExplorer(path.join(folder, 'inside.txt'))
const revealed = await wait(() => windowsAt(folder) > 0)
console.log(revealed ? 'ok   reveal: Explorer opened the containing folder' : 'FAIL reveal')
ok &&= revealed
closeAt(folder)
await wait(() => windowsAt(folder) === 0)

fs.rmSync(dir, { recursive: true, force: true })
process.exit(ok ? 0 : 1)
