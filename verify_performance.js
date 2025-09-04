const { createClient } = require('@supabase/supabase-js')

// Supabase configuration
const supabaseUrl = 'https://btugywkltavbogdnhwpu.supabase.co'
const supabaseKey =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ0dWd5d2tsdGF2Ym9nZG5od3B1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDMwMDYzMywiZXhwIjoyMDY1ODc2NjMzfQ.Sr0IFXaNOPphT9wTPlXgEYxok9Fg-82YGYwOOzVDEQ4'
const supabase = createClient(supabaseUrl, supabaseKey)

async function verifyIndexesAndPerformance() {
  console.log('🔍 데이터베이스 성능 및 인덱스 검증 시작...\n')

  try {
    // 1. 인덱스 존재 확인
    console.log('📊 생성된 인덱스 확인 중...')
    const { data: indexes, error: indexError } = await supabase
      .from('posts_performance_indexes')
      .select('*')
      .like('indexname', 'idx_%')

    if (indexError) {
      console.log('❌ 인덱스 확인 실패:', indexError.message)
    } else {
      console.log('✅ 생성된 인덱스 목록:')
      indexes.forEach(idx => {
        console.log(`   - ${idx.indexname} (${idx.tablename})`)
      })
    }

    // 2. 게시글 조회 성능 테스트
    console.log('\n🚀 게시글 조회 성능 테스트...')
    const startTime = Date.now()

    const { data: posts, error: postsError } = await supabase
      .from('posts')
      .select('*')
      .eq('is_deleted', false)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .range(0, 9)

    const queryTime = Date.now() - startTime

    if (postsError) {
      console.log('❌ 게시글 조회 실패:', postsError.message)
    } else {
      console.log(`✅ 게시글 10개 조회 완료: ${queryTime}ms`)
      console.log(`📄 조회된 게시글 수: ${posts.length}`)
    }

    // 3. 배치 쿼리 성능 테스트 (댓글 수)
    if (posts && posts.length > 0) {
      console.log('\n💬 댓글 수 배치 조회 테스트...')
      const postIds = posts.map(p => p.id)
      const commentStartTime = Date.now()

      const { data: comments, error: commentError } = await supabase
        .from('comments')
        .select('post_id')
        .in('post_id', postIds)

      const commentQueryTime = Date.now() - commentStartTime

      if (commentError) {
        console.log('❌ 댓글 배치 조회 실패:', commentError.message)
      } else {
        console.log(`✅ 댓글 배치 조회 완료: ${commentQueryTime}ms`)
        console.log(`💬 총 댓글 수: ${comments.length}`)
      }
    }

    // 4. 좋아요 배치 조회 테스트
    if (posts && posts.length > 0) {
      console.log('\n❤️ 좋아요 배치 조회 테스트...')
      const postIds = posts.map(p => p.id)
      const likeStartTime = Date.now()

      const { data: likes, error: likeError } = await supabase
        .from('post_likes')
        .select('post_id')
        .in('post_id', postIds)

      const likeQueryTime = Date.now() - likeStartTime

      if (likeError) {
        console.log('❌ 좋아요 배치 조회 실패:', likeError.message)
      } else {
        console.log(`✅ 좋아요 배치 조회 완료: ${likeQueryTime}ms`)
        console.log(`❤️ 총 좋아요 수: ${likes.length}`)
      }
    }

    console.log('\n🎉 성능 검증 완료!')
  } catch (error) {
    console.error('❌ 검증 중 오류 발생:', error.message)
  }
}

verifyIndexesAndPerformance()
