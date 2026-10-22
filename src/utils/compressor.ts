export async function compressImage(file: File): Promise<{ blob: Blob; savedPercentage: number }> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve({ blob: file, savedPercentage: 0 })
          return
        }

        // Limit maximum dimension to 1600px
        const maxDim = 1600
        let width = img.width
        let height = img.height

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width)
            width = maxDim
          } else {
            width = Math.round((width * maxDim) / height)
            height = maxDim
          }
        }

        canvas.width = width
        canvas.height = height
        ctx.drawImage(img, 0, 0, width, height)

        // Compress to JPEG at 75% quality
        canvas.toBlob(
          (blob) => {
            if (blob && blob.size < file.size) {
              const saved = Math.round(((file.size - blob.size) / file.size) * 100)
              resolve({ blob, savedPercentage: saved })
            } else {
              resolve({ blob: file, savedPercentage: 0 })
            }
          },
          'image/jpeg',
          0.75
        )
      }
      img.onerror = () => {
        resolve({ blob: file, savedPercentage: 0 })
      }
      img.src = e.target?.result as string
    }
    reader.onerror = () => {
      resolve({ blob: file, savedPercentage: 0 })
    }
    reader.readAsDataURL(file)
  })
}

export async function compressFile(
  file: File,
  onProgress: (progress: number) => void
): Promise<{ blob: Blob; originalSize: number; compressedSize: number; savedPercentage: number }> {
  const originalSize = file.size
  const type = file.type.toLowerCase()
  const name = file.name.toLowerCase()

  onProgress(20)

  if (type.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(name)) {
    onProgress(50)
    const result = await compressImage(file)
    onProgress(100)
    return {
      blob: result.blob,
      originalSize,
      compressedSize: result.blob.size,
      savedPercentage: result.savedPercentage,
    }
  }

  // Everything else (PDF, Word, Excel, PowerPoint, text, HTML) uploads unchanged.
  onProgress(100)
  return {
    blob: file,
    originalSize,
    compressedSize: originalSize,
    savedPercentage: 0,
  }
}
