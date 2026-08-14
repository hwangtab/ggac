import { createServiceRoleClient } from '@/lib/server/supabaseAdmin'

/**
 * Supabase Storage에 service-role로 접근할 수 있는지. 교차 제공자 폴백 전용이다.
 *
 * createServiceRoleClient()는 두 값이 없으면 requireServerEnv로 던진다. 선택된
 * 제공자라면 그게 맞지만, 폴백 경로에서는 설정이 없는 게 정상이므로 부르기 전에
 * 걸러야 없는 문서가 404 대신 500으로 나가지 않는다.
 * (requireServerEnv와 같은 trim 기준을 쓴다.)
 */
export function hasSupabaseServiceRole(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  )
}

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
