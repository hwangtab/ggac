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
  contentType: string
): Promise<{ url: string; pathname: string }> {
  const client = admin()
  const { error } = await client.storage
    .from(bucket)
    .upload(key, body, { contentType, upsert: true })
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
