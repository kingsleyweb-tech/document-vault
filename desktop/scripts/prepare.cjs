'use strict'

// Copies the web build and the companion into this folder so the desktop app
// ships its own copies. Run from the desktop folder; builds the website first.
//   node scripts/prepare.cjs              build the website, then copy
//   node scripts/prepare.cjs --if-missing  only when nothing was copied yet
//   node scripts/prepare.cjs --mac         also add the drawing library for both
//                                          Mac processors (dist:mac builds both)

const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const desktop = path.resolve(__dirname, '..')
const repo = path.resolve(desktop, '..')
const web = path.join(desktop, 'web')
const companion = path.join(desktop, 'companion')

const prepared = fs.existsSync(path.join(web, 'index.html')) && fs.existsSync(path.join(companion, 'node_modules', 'tesseract.js'))
if (process.argv.includes('--if-missing') && prepared) {
  process.exit(0)
}

execSync('npm run build', { cwd: repo, stdio: 'inherit' })

fs.rmSync(web, { recursive: true, force: true })
fs.cpSync(path.join(repo, 'dist'), web, { recursive: true })

fs.rmSync(companion, { recursive: true, force: true })
fs.mkdirSync(companion)
fs.cpSync(path.join(repo, 'companion', 'src'), path.join(companion, 'src'), { recursive: true })
fs.copyFileSync(path.join(repo, 'companion', 'package.json'), path.join(companion, 'package.json'))
fs.copyFileSync(path.join(repo, 'companion', 'package-lock.json'), path.join(companion, 'package-lock.json'))
// The document readers (PDF, Word, EPUB) and text recognition (Tesseract with
// its English data, and the native drawing library that turns scanned pages
// into pictures), exactly as locked. npm installs the drawing library's binary
// for this computer's system and processor only.
execSync('npm ci --omit=dev --no-audit --no-fund --ignore-scripts', { cwd: companion, stdio: 'inherit' })

const modules = path.join(companion, 'node_modules')
if (process.argv.includes('--mac')) {
  const { version } = require(path.join(modules, '@napi-rs', 'canvas', 'package.json'))
  for (const cpu of ['arm64', 'x64']) {
    if (fs.existsSync(path.join(modules, '@napi-rs', `canvas-darwin-${cpu}`))) continue
    execSync(`npm install --no-save --no-audit --no-fund --ignore-scripts --force --os=darwin --cpu=${cpu} @napi-rs/canvas-darwin-${cpu}@${version}`, { cwd: companion, stdio: 'inherit' })
  }
}

// Only what the companion uses is shipped. Text recognition runs in LSTM mode,
// for which Node loads tesseract-core-{,simd-,relaxedsimd-}lstm.js and the .wasm
// next to it; the other engine builds and the browser copies (.wasm.js) are not
// used. The English data is read from 4.0.0_best_int; the larger 4.0.0 copy is not.
const core = path.join(modules, 'tesseract.js-core')
for (const file of fs.readdirSync(core)) {
  if (/^tesseract-core.*\.(js|wasm)$/.test(file) && !/-lstm\.(js|wasm)$/.test(file)) fs.rmSync(path.join(core, file))
}
fs.rmSync(path.join(modules, '@tesseract.js-data', 'eng', '4.0.0'), { recursive: true, force: true })
// HEIC photos are decoded with the self-contained WebAssembly bundle (libheif-wasm/libheif-bundle.js);
// the asm.js build, the separate .wasm build and the ES module copy are not used.
const libheif = path.join(modules, 'libheif-js')
fs.rmSync(path.join(libheif, 'libheif', 'libheif.js'), { force: true })
for (const file of ['libheif-bundle.mjs', 'libheif.js', 'libheif.wasm']) fs.rmSync(path.join(libheif, 'libheif-wasm', file), { force: true })
for (const required of [
  path.join(core, 'tesseract-core-lstm.wasm'),
  path.join(core, 'tesseract-core-simd-lstm.wasm'),
  path.join(core, 'tesseract-core-relaxedsimd-lstm.wasm'),
  path.join(modules, '@tesseract.js-data', 'eng', '4.0.0_best_int', 'eng.traineddata.gz'),
  path.join(libheif, 'libheif-wasm', 'libheif-bundle.js'),
  path.join(modules, 'word-extractor', 'package.json'),
]) {
  if (!fs.existsSync(required)) throw new Error(`Companion file missing after install: ${required}`)
}

console.log(`Copied the web build to ${web} and the companion to ${companion}.`)
