// Converts pictures the web app cannot draw (HEIC and HEIF photos, as taken by
// iPhones) to JPEG. Runs inside the extraction worker, like reading text.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// Wider photos are made smaller: a 48-megapixel photo is shown on a screen, not printed.
const MAX_WIDTH = 2400

export async function convertPicture(extension, bytes) {
  if (extension !== 'heic' && extension !== 'heif') {
    throw Object.assign(new Error('This picture type is not converted.'), { code: 'UNSUPPORTED' })
  }
  const decode = require('heic-decode')
  const { width, height, data } = await decode({ buffer: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) })
  const { createCanvas, ImageData } = require('@napi-rs/canvas')
  const full = createCanvas(width, height)
  full.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width, height), 0, 0)
  let canvas = full
  if (width > MAX_WIDTH) {
    canvas = createCanvas(MAX_WIDTH, Math.round((height * MAX_WIDTH) / width))
    canvas.getContext('2d').drawImage(full, 0, 0, canvas.width, canvas.height)
  }
  return { bytes: new Uint8Array(await canvas.encode('jpeg', 88)) }
}
