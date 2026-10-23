import { execFile, spawn } from 'node:child_process'

// Opens files and folders through Windows. Paths reach PowerShell through an
// environment variable, never as part of the command text, so a file name
// cannot inject commands. Callers decide what may be opened (see server.js).

const POWERSHELL = 'powershell.exe'
const BASE_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']

function runPowerShell(script, env, { sta = false, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      POWERSHELL,
      [...(sta ? ['-STA'] : []), ...BASE_ARGS, script],
      { env: { ...process.env, ...env }, windowsHide: true, timeout, encoding: 'utf8', maxBuffer: 64 * 1024 },
      (error, stdout, stderr) => (error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout)),
    )
  })
}

// Shell-execute with the default verb: the same as double-clicking the item.
// (Windows PowerShell 5.1's Start-Process has no -LiteralPath, and -FilePath
// treats [ ] in names as wildcards.)
const OPEN_SCRIPT =
  '$info = New-Object System.Diagnostics.ProcessStartInfo; $info.FileName = $env:DV_TARGET; $info.UseShellExecute = $true; ' +
  '[void][System.Diagnostics.Process]::Start($info)'

/** Opens a document with its associated app, a folder in File Explorer, or a web link in the default browser. */
export function openWithDefaultApp(target) {
  return runPowerShell(OPEN_SCRIPT, { DV_TARGET: target })
}

/** Opens File Explorer with the item selected. Never runs the item itself. */
export function revealInExplorer(target) {
  return new Promise((resolve, reject) => {
    // explorer.exe needs `/select,"path"` as one verbatim argument; Windows paths cannot contain quotes.
    if (target.includes('"')) {
      reject(new Error('Invalid path'))
      return
    }
    const child = spawn('explorer.exe', [`/select,"${target}"`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' })
    child.on('error', reject)
    child.on('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

const PICK_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Choose a folder for Document Vault to index. Document Vault reads the names and the text of documents in this folder only, on this computer.'
$dialog.ShowNewFolderButton = $false
if ($env:DV_START) { $dialog.SelectedPath = $env:DV_START }
if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }
$owner.Dispose()
`

/** Shows the Windows folder picker on this computer. Resolves to the chosen path, or null if cancelled. */
export async function pickFolder({ defaultPath } = {}) {
  const output = await runPowerShell(PICK_SCRIPT, defaultPath ? { DV_START: defaultPath } : {}, { sta: true, timeout: 10 * 60 * 1000 })
  const chosen = output.trim()
  return chosen.length > 0 ? chosen : null
}
