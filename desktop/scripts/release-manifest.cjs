'use strict'

// Fills in public/releases/latest.json from installers that were actually
// built, and writes SHA256SUMS.txt beside them. A build is marked available
// only when its file is in the folder; the rest stay "not yet available".
//
//   node scripts/release-manifest.cjs --dir <folder with installers> \
//     --base-url https://github.com/<owner>/<repo>/releases/download/v<version> \
//     [--signed windows-x64,macos-arm64] [--out ../public/releases/latest.json]
//
// Upload the files and SHA256SUMS.txt to that address before deploying the
// website with the new manifest, or the download buttons will point nowhere.

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
  })
}

/** The file name a build has for a version: the old version in the name is swapped for the new one. */
function fileNameFor(build, fromVersion, toVersion) {
  return build.fileName.split(fromVersion).join(toVersion)
}

/**
 * Returns the new manifest and the checksum lines. `files` maps a file name to
 * { size, sha256 } for the installers that exist.
 */
function buildManifest(previous, { version, baseUrl, files, signed = [], releasedAt }) {
  if (!/^https:\/\//.test(baseUrl)) throw new Error('The base address must start with https://')
  const base = baseUrl.replace(/\/+$/, '')
  const sums = []
  const builds = previous.builds.map((build) => {
    const fileName = fileNameFor(build, previous.version, version)
    const found = files[fileName]
    if (!found) return { ...build, fileName, url: null, size: null, sha256: null, available: false, signed: false }
    sums.push(`${found.sha256}  ${fileName}`)
    return {
      ...build,
      fileName,
      url: `${base}/${encodeURIComponent(fileName)}`,
      size: found.size,
      sha256: found.sha256,
      available: true,
      signed: signed.includes(build.id),
    }
  })
  return { manifest: { ...previous, version, releasedAt, builds }, sums }
}

function readArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (key.startsWith('--')) args[key.slice(2)] = argv[index + 1]
    if (key.startsWith('--')) index += 1
  }
  return args
}

async function main() {
  const args = readArgs(process.argv.slice(2))
  if (!args.dir || !args['base-url']) {
    console.error('Usage: node scripts/release-manifest.cjs --dir <folder> --base-url <https://...> [--signed ids] [--out file]')
    process.exit(1)
  }
  const desktop = path.resolve(__dirname, '..')
  const out = path.resolve(args.out ?? path.join(desktop, '..', 'public', 'releases', 'latest.json'))
  const { version } = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'))
  const previous = JSON.parse(fs.readFileSync(out, 'utf8'))

  const files = {}
  for (const name of fs.readdirSync(args.dir)) {
    const file = path.join(args.dir, name)
    if (!fs.statSync(file).isFile()) continue
    files[name] = { size: fs.statSync(file).size, sha256: await sha256(file) }
  }

  const { manifest, sums } = buildManifest(previous, {
    version,
    baseUrl: args['base-url'],
    files,
    signed: (args.signed ?? '').split(',').filter(Boolean),
    releasedAt: new Date().toISOString(),
  })
  if (sums.length === 0) {
    console.error(`No installers for version ${version} were found in ${args.dir}; nothing was changed.`)
    process.exit(1)
  }
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n')
  fs.writeFileSync(path.join(args.dir, 'SHA256SUMS.txt'), sums.join('\n') + '\n')
  for (const build of manifest.builds) console.log(`${build.available ? 'available    ' : 'not available'}  ${build.id}  ${build.fileName}`)
  console.log(`Wrote ${out} and ${path.join(args.dir, 'SHA256SUMS.txt')}.`)
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}

module.exports = { buildManifest, fileNameFor }
