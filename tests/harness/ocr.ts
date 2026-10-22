import { recognizeImage, recognizePdf } from '../../src/services/ocr'

const input = document.querySelector('input')!
const status = document.querySelector('[data-testid=status]')!
const output = document.querySelector('[data-testid=text]')!

input.addEventListener('change', async () => {
  const file = input.files?.[0]
  if (!file) return
  status.textContent = 'running'
  const started = performance.now()
  try {
    const text = /\.pdf$/i.test(file.name) ? await recognizePdf(file) : await recognizeImage(file)
    output.textContent = text
    status.textContent = `done ${Math.round(performance.now() - started)}ms`
  } catch (error) {
    status.textContent = `error ${error instanceof Error ? error.message : String(error)}`
  }
})
