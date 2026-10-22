import fs from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Text recognition (OCR) runs Tesseract in a web worker. Its worker, engine and
// English language data are served from this site under /ocr/ instead of a
// public CDN, so documents' pictures never leave the browser and the content
// security policy stays 'self'. The files come straight from node_modules.
const ocrAssets: Record<string, string> = {
  'ocr/worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'ocr/core/tesseract-core-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
  'ocr/core/tesseract-core-simd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'ocr/lang/eng.traineddata.gz': 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
}

function ocrAssetsPlugin(): Plugin {
  return {
    name: 'document-vault-ocr-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '').split('?')[0].replace(/^\//, '')
        const source = ocrAssets[path]
        if (!source) return next()
        // The language file is gzip data that Tesseract unpacks itself, so it
        // must not be sent with a Content-Encoding header.
        response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream')
        fs.createReadStream(source).pipe(response)
      })
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(ocrAssets)) {
        this.emitFile({ type: 'asset', fileName, source: fs.readFileSync(source) })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), ocrAssetsPlugin()],
})
