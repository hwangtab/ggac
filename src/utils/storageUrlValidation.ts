export function isProjectStoragePublicUrl(value: string, bucket: string, pathPrefix = ''): boolean {
  return getProjectStorageObjectPath(value, bucket, pathPrefix) !== null
}

export function isProjectStorageObjectPath(value: string, pathPrefix = ''): boolean {
  if (typeof value !== 'string') return false

  const trimmed = value.trim()
  const normalizedPrefix = pathPrefix.replace(/^\/+|\/+$/g, '')
  if (!trimmed || trimmed !== value || /[\u0000-\u001f\u007f\\]/.test(trimmed)) return false
  if (trimmed.startsWith('/') || trimmed.split('/').some(segment => segment === '..')) return false

  return normalizedPrefix ? trimmed.startsWith(`${normalizedPrefix}/`) : true
}

export function getProjectStorageObjectPath(
  value: string,
  bucket: string,
  pathPrefix = ''
): string | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) return null

  try {
    const fileUrl = new URL(value)
    const storageUrl = new URL(supabaseUrl)
    const normalizedPrefix = pathPrefix.replace(/^\/+|\/+$/g, '')
    const bucketPath = `/storage/v1/object/public/${bucket}/`
    const expectedPath = normalizedPrefix ? `${bucketPath}${normalizedPrefix}/` : bucketPath

    if (fileUrl.origin !== storageUrl.origin || !fileUrl.pathname.startsWith(expectedPath)) {
      return null
    }

    return decodeURIComponent(fileUrl.pathname.slice(bucketPath.length))
  } catch {
    return null
  }
}
