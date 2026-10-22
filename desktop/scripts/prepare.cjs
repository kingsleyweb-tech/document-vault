'use strict'

// Copies the web build and the companion into this folder so the desktop app
// ships its own copies. Run from the desktop folder; builds the website first.
//   node scripts/prepare.cjs              build the website, then copy
//   node scripts/prepare.cjs --if-missing  only when nothing was copied yet

const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const desktop = path.resolve(__dirname, '..')
const repo = path.resolve(desktop, '..')
const web = path.join(desktop, 'web')
const companion = path.join(desktop, 'companion')

if (process.argv.includes('--if-missing') && fs.existsSync(path.join(web, 'index.html')) && fs.existsSync(companion)) {
  process.exit(0)
}

execSync('npm run build', { cwd: repo, stdio: 'inherit' })

fs.rmSync(web, { recursive: true, force: true })
fs.cpSync(path.join(repo, 'dist'), web, { recursive: true })

fs.rmSync(companion, { recursive: true, force: true })
fs.mkdirSync(companion)
fs.cpSync(path.join(repo, 'companion', 'src'), path.join(companion, 'src'), { recursive: true })
fs.copyFileSync(path.join(repo, 'companion', 'package.json'), path.join(companion, 'package.json'))

console.log(`Copied the web build to ${web} and the companion to ${companion}.`)
