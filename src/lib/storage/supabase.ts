import { createServiceRoleClient } from '@/lib/server/supabaseAdmin'

export async function putSupabaseObject(
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
  // storage-js upload()의 SDK 기본값(upsert: false)과 같은 기본값을 유지한다.
  // provider.ts의 putPublicObject는 이 기본값에 기대지 않고 매번 명시적으로 값을 넘긴다.
  upsert: boolean = false
): Promise<{ url: string; pathname: string }> {
  const client = createServiceRoleClient()
  const { error } = await client.storage.from(bucket).upload(key, body, { contentType, upsert })
  if (error) throw new Error(`Supabase upload failed: ${error.message}`)

  const { data } = client.storage.from(bucket).getPublicUrl(key)
  return { url: data.publicUrl, pathname: `${bucket}/${key}` }
}

export async function deleteSupabaseObject(bucket: string, key: string): Promise<void> {
  const { error } = await createServiceRoleClient().storage.from(bucket).remove([key])
  if (error) throw new Error(`Supabase delete failed: ${error.message}`)
}

export function supabasePublicUrl(bucket: string, key: string): string {
  const { data } = createServiceRoleClient().storage.from(bucket).getPublicUrl(key)
  return data.publicUrl
}

/**
 * 비공개 버킷에서 객체를 내려받는다. 서명 URL을 만들지 않고 service-role
 * 클라이언트로 바이트를 직접 받는다 — 라우트가 이미 권한을 검사한 뒤 부른다.
 * 없는 객체면 null을 돌려준다.
 */
export async function downloadSupabaseObject(
  bucket: string,
  key: string
): Promise<{ body: Blob; contentType: string } | null> {
  const { data, error } = await createServiceRoleClient().storage.from(bucket).download(key)
  if (error || !data) return null
  return { body: data, contentType: data.type || 'application/octet-stream' }
}
