import { isSupportedFile } from './fileUtils'

export function validateUploadFile(file: File): string | null {
  if (!isSupportedFile(file)) {
    return 'This file type is not supported yet.'
  }

  const maxBytes = 100 * 1024 * 1024
  if (file.size > maxBytes) {
    return 'Files must be 100 MB or smaller for this browser upload flow.'
  }

  return null
}
