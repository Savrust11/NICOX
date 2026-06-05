// Compress an image file to stay under Vercel's 4.5MB serverless payload limit.
// Returns a new File (JPEG) or the original if it's already small enough.
export async function compressImage(file, { maxWidth = 1600, quality = 0.82 } = {}) {
  if (!file || !file.type.startsWith('image/')) return file
  if (file.size < 600 * 1024) return file

  try {
    const img = new Image()
    img.src = URL.createObjectURL(file)
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
    })

    let { width, height } = img
    if (width > maxWidth) {
      height = Math.round((height * maxWidth) / width)
      width = maxWidth
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0, width, height)

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', quality)
    })

    URL.revokeObjectURL(img.src)

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'photo'
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' })
  } catch (err) {
    console.warn('Image compression failed, sending original:', err)
    return file
  }
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
