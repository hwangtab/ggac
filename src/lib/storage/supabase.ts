import { createClient } from '@supabase/supabase-js'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase storage credentials are not set')
  return createClient(url, key, { auth: { persistSession: false } })
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
  const client = admin()
  const { error } = await client.storage.from(bucket).upload(key, body, { contentType, upsert })
  if (error) throw new Error(`Supabase upload failed: ${error.message}`)

  const { data } = client.storage.from(bucket).getPublicUrl(key)
  return { url: data.publicUrl, pathname: `${bucket}/${key}` }
}

export async function deleteSupabaseObject(bucket: string, key: string): Promise<void> {
  const { error } = await admin().storage.from(bucket).remove([key])
  if (error) throw new Error(`Supabase delete failed: ${error.message}`)
}

export function supabasePublicUrl(bucket: string, key: string): string {
  const { data } = admin().storage.from(bucket).getPublicUrl(key)
  return data.publicUrl
}
