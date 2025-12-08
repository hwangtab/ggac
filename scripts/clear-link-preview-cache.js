/**
 * 네이버 예약 링크 프리뷰 캐시 삭제 스크립트
 * 사용법: node scripts/clear-link-preview-cache.js <url>
 */

const { createClient } = require('@supabase/supabase-js')

async function clearLinkPreviewCache(url) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    console.error('❌ Missing Supabase credentials')
    console.error('Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  try {
    console.log(`🔍 Searching for cached preview: ${url}`)

    // 먼저 캐시가 있는지 확인
    const { data: existing, error: selectError } = await supabase
      .from('link_previews')
      .select('*')
      .eq('url', url)
      .single()

    if (selectError && selectError.code !== 'PGRST116') {
      // PGRST116 = not found
      throw selectError
    }

    if (!existing) {
      console.log('ℹ️ No cached preview found for this URL')
      return
    }

    console.log('📦 Found cached preview:')
    console.log(`   Title: ${existing.data?.title}`)
    console.log(`   Last fetched: ${existing.last_fetched}`)
    console.log(`   TTL: ${existing.ttl_seconds} seconds`)

    // 캐시 삭제
    const { error: deleteError } = await supabase.from('link_previews').delete().eq('url', url)

    if (deleteError) {
      throw deleteError
    }

    console.log('✅ Successfully deleted cached preview')
    console.log('🔄 Next page load will fetch fresh metadata from Naver booking')
  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}

// CLI 인자로 URL 받기
const url =
  process.argv[2] ||
  'https://booking.naver.com/booking/5/bizes/1442738/items/7129243?startDateTime=2025-11-23T00%3A00%3A00%2B09%3A00&tab=book'

clearLinkPreviewCache(url)
