// ⛔ 무해화됨 — Supabase→Turso 컷오버 잔재. **실행해도 즉시 중단된다.**
//
// 이 스크립트는 Supabase `link_previews`에서 캐시 행을 DELETE하고
// `✅ Successfully deleted cached preview`를 찍는다.
//
// 컷오버(2026-08-26) 이후 앱은 Supabase를 어디에서도 읽지 않는다. 그런데
// `.env.local`에 Supabase 값이 남아 있으면 이 스크립트는 **버려진 사본을
// 건드리고 성공 메시지를 내고 끝난다** — 화면은 그대로인데 아무도 이유를
// 모른다. 조용한 성공이 이 저장소에서 가장 비싼 실패이므로 아래 가드가
// 무조건 막는다. 지금 이걸 막고 있는 건 `dotenv` 미설치나 따옴표 파싱
// 실패 같은 **우연**이었다 — `npm i dotenv` 한 번이나
// `set -a; source .env.local; set +a`(scripts/turso/README.md가 DB 작업 전에
// 하라고 안내하는 바로 그 명령)면 그 우연은 사라진다.
//
// **링크 프리뷰 캐시는 지금도 쓰이고 있고, 그 권위는 Turso다.**
// 스키마: `src/db/schema/ops.ts`의 `linkPreviews`(테이블 `link_previews`),
// 쿼리 계층: `src/db/queries/misc.ts`. 실제로 캐시를 비우려면 Turso에서
// 지워야 한다 — 예: turso db shell ggac-prod "delete from link_previews where url='<url>'"
// (운영 DB에 직접 쓰는 명령이므로 실행 전에 대상 URL을 반드시 확인할 것).
//
// 실행 흐름은 그대로 남겨 둔다(다시 필요해지면 포팅할 때 원본 로직이 필요하다).
console.error(
  '[중단] 이 스크립트는 Supabase `link_previews`를 지웁니다. 링크 프리뷰 캐시의 권위는 ' +
    'Turso이고 앱은 Supabase를 읽지 않습니다 — 실행해도 버려진 사본만 비워집니다. ' +
    '실제로 비우려면 Turso `link_previews`를 지우십시오(src/db/queries/misc.ts 참고).'
)
process.exit(1)
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
