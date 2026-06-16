const SAFE_BOARD_DOCUMENT_FILE_NAME = /^[a-zA-Z0-9._\-가-힣]+$/

export function isSafeBoardDocumentStoragePath(filePath: string, ownerId: string): boolean {
  if (!filePath || !ownerId || filePath.length > 512) return false
  if (!filePath.startsWith(`${ownerId}/`)) return false

  const fileName = filePath.slice(ownerId.length + 1)
  if (!fileName || fileName === '.' || fileName === '..') return false
  if (fileName.includes('/') || fileName.includes('\\')) return false

  return SAFE_BOARD_DOCUMENT_FILE_NAME.test(fileName)
}
