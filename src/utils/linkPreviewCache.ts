import type { LinkPreview } from '@/types'

// Persistent cache backed by Supabase (service role when available)

type SupabaseClient = any

async function getAdminClient(): Promise<SupabaseClient | null> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) return null
    const { createClient } = await import('@supabase/supabase-js')
    return createClient(url, serviceKey)
  } catch {
    return null
  }
}

export async function getCachedPreviewFromDB(url: string): Promise<LinkPreview | null> {
  const client = await getAdminClient()
  if (!client) return null
  try {
    const { data, error } = await client
      .from('link_previews')
      .select('data,last_fetched,ttl_seconds')
      .eq('url', url)
      .single()
    if (error || !data) return null
    const last = new Date(data.last_fetched).getTime()
    const ttlMs = (data.ttl_seconds ?? 21600) * 1000
    if (Date.now() - last <= ttlMs) {
      return data.data as LinkPreview
    }
    return null
  } catch {
    return null
  }
}

export async function setCachedPreviewToDB(
  url: string,
  preview: LinkPreview,
  ttlSeconds: number = 21600
): Promise<void> {
  const client = await getAdminClient()
  if (!client) return
  try {
    await client.from('link_previews').upsert(
      {
        url,
        data: preview,
        last_fetched: new Date().toISOString(),
        ttl_seconds: ttlSeconds,
      },
      { onConflict: 'url' }
    )
  } catch {
    // ignore
  }
}
