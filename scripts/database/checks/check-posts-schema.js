// ⛔ 무해화됨 — Supabase→Turso 컷오버 잔재. **실행해도 즉시 중단된다.**
//
// Supabase `posts`·`comments`의 컬럼 구성을 조회해 보고한다.
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
// 지금 무엇이 들어 있는지 보려면 Turso를 봐라: `turso db shell ggac-prod`,
// 또는 쿼리 계층 `src/db/queries/`(profiles.ts·posts.ts·activities.ts …).
// 스키마 자체는 `src/db/schema/`가 정본이고, `npm run test:schema-contract`가
// 코드-스키마 계약을 정적으로 대조한다.
//
// 실행 흐름은 그대로 남겨 둔다(다시 필요해지면 포팅할 때 원본 로직이 필요하다).
console.error(
  '[중단] 이 스크립트는 Supabase를 조회해 상태를 보고합니다. 데이터의 권위는 Turso이므로 ' +
    '버려진 사본을 "정상"이라고 보고하게 됩니다 — turso db shell ggac-prod 또는 ' +
    'src/db/queries/ 를 보십시오.'
)
process.exit(1)
/**
 * posts 테이블 스키마 확인 스크립트
 */

const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')

// .env.local 파일 수동 로드
const envFile = fs.readFileSync('.env.local', 'utf8')
const envVars = {}
envFile.split('\n').forEach(line => {
  const [key, value] = line.split('=')
  if (key && value) {
    envVars[key.trim()] = value.trim()
  }
})
Object.assign(process.env, envVars)

async function checkPostsSchema() {
  console.log('=== posts 테이블 스키마 확인 ===\n')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    // posts 테이블 구조 확인 (샘플 데이터로)
    console.log('1. posts 테이블 샘플 데이터 조회')
    const { data: posts, error: postsError } = await supabase.from('posts').select('*').limit(1)

    if (postsError) {
      console.error('❌ posts 조회 오류:', postsError.message)
    } else {
      console.log('✅ posts 테이블 컬럼들:')
      if (posts.length > 0) {
        Object.keys(posts[0]).forEach(column => {
          console.log(`  - ${column}: ${typeof posts[0][column]}`)
        })
      } else {
        console.log('  (데이터가 없어서 컬럼 구조 확인 불가)')
      }
    }

    // 전체 posts 수 확인
    console.log('\n2. posts 테이블 기본 정보')
    const { data: allPosts, error: allError } = await supabase
      .from('posts')
      .select('id, title, created_at, category')

    if (allError) {
      console.error('❌ 전체 posts 조회 오류:', allError.message)
    } else {
      console.log(`✅ 전체 게시글 수: ${allPosts.length}개`)
      if (allPosts.length > 0) {
        console.log('최근 게시글들:')
        allPosts.slice(0, 3).forEach(post => {
          console.log(`  - "${post.title}" (${post.category}) - ${post.created_at}`)
        })
      }
    }

    // comments 테이블도 확인
    console.log('\n3. comments 테이블 기본 정보')
    const { data: allComments, error: commentsError } = await supabase
      .from('comments')
      .select('id, post_id, content, created_at')

    if (commentsError) {
      console.error('❌ comments 조회 오류:', commentsError.message)
    } else {
      console.log(`✅ 전체 댓글 수: ${allComments.length}개`)
      if (allComments.length > 0) {
        console.log('최근 댓글들:')
        allComments.slice(0, 3).forEach(comment => {
          console.log(
            `  - "${comment.content?.substring(0, 30)}..." (게시글: ${comment.post_id}) - ${comment.created_at}`
          )
        })
      }
    }
  } catch (error) {
    console.error('스키마 확인 중 오류 발생:', error)
  }
}

checkPostsSchema()
