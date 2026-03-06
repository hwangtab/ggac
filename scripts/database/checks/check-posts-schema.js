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
