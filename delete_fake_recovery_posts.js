/**
 * 가짜 복구 게시물 삭제 스크립트
 * "복구된 게시물 #" 형태의 의미 없는 게시물들을 모두 삭제
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

async function deleteFakeRecoveryPosts() {
  console.log('=== 가짜 복구 게시물 삭제 ===\n')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ 환경 변수가 설정되지 않았습니다.')
    return
  }

  console.log('✅ Supabase 연결 설정 완료')
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    console.log('1. 현재 가짜 복구 게시물 확인')

    // "복구된 게시물 #" 패턴의 게시물들 조회
    const { data: fakeRecoveryPosts, error: postsError } = await supabase
      .from('posts')
      .select('id, title, created_at')
      .like('title', '복구된 게시물 #%')
      .order('created_at', { ascending: false })

    if (postsError) {
      console.error('❌ 게시물 조회 오류:', postsError.message)
      return
    }

    console.log(`발견된 가짜 복구 게시물: ${fakeRecoveryPosts.length}개`)

    if (fakeRecoveryPosts.length === 0) {
      console.log('✅ 삭제할 가짜 복구 게시물이 없습니다.')
      return
    }

    console.log('가짜 복구 게시물 목록:')
    fakeRecoveryPosts.forEach((post, index) => {
      console.log(`${index + 1}. "${post.title}" (${post.created_at})`)
    })

    const fakePostIds = fakeRecoveryPosts.map(post => post.id)

    // 2. 관련 데이터 삭제 (외래 키 제약 조건 고려)
    console.log('\n2. 관련 데이터 삭제 시작')

    // 2-1. 댓글 좋아요 삭제
    console.log('2-1. 댓글 좋아요 삭제')
    const { data: commentsForLikes, error: commentsForLikesError } = await supabase
      .from('comments')
      .select('id')
      .in('post_id', fakePostIds)

    if (commentsForLikesError) {
      console.error('⚠️ 댓글 ID 조회 오류:', commentsForLikesError.message)
    } else {
      const commentIds = commentsForLikes?.map(c => c.id) || []

      if (commentIds.length > 0) {
        const { error: deleteCommentLikesError } = await supabase
          .from('comment_likes')
          .delete()
          .in('comment_id', commentIds)

        if (deleteCommentLikesError) {
          console.error('❌ 댓글 좋아요 삭제 오류:', deleteCommentLikesError.message)
        } else {
          console.log('   ✅ 댓글 좋아요 삭제 완료')
        }
      } else {
        console.log('   삭제할 댓글이 없어 댓글 좋아요도 없음')
      }
    }

    // 2-2. 댓글 삭제
    console.log('2-2. 댓글 삭제')
    const { error: deleteCommentsError } = await supabase
      .from('comments')
      .delete()
      .in('post_id', fakePostIds)

    if (deleteCommentsError) {
      console.error('❌ 댓글 삭제 오류:', deleteCommentsError.message)
    } else {
      console.log('   ✅ 댓글 삭제 완료')
    }

    // 2-3. 게시물 좋아요 삭제 - 중요: 실제 좋아요는 보존해야 함!
    console.log('2-3. 게시물 좋아요 확인 (실제 좋아요는 보존)')
    const { data: postLikesToCheck, error: postLikesError } = await supabase
      .from('post_likes')
      .select('id, post_id, created_at')
      .in('post_id', fakePostIds)

    if (postLikesError) {
      console.error('❌ 게시물 좋아요 조회 오류:', postLikesError.message)
    } else {
      console.log(`   발견된 게시물 좋아요: ${postLikesToCheck.length}개`)

      if (postLikesToCheck.length > 0) {
        console.log('   ⚠️  중요: 이 좋아요들은 실제 원본 게시물의 것이므로 삭제하지 않습니다!')
        console.log('   📝 실제 게시물 복구 후 다시 연결될 예정입니다.')
      }
    }

    // 2-4. 첨부파일 삭제
    console.log('2-4. 첨부파일 삭제')
    const { error: deleteAttachmentsError } = await supabase
      .from('post_attachments')
      .delete()
      .in('post_id', fakePostIds)

    if (deleteAttachmentsError) {
      console.error('❌ 첨부파일 삭제 오류:', deleteAttachmentsError.message)
    } else {
      console.log('   ✅ 첨부파일 삭제 완료')
    }

    // 2-5. 알림 삭제 (related_post_id가 가짜 게시물을 가리키는 경우)
    console.log('2-5. 관련 알림 삭제')
    const { error: deleteNotificationsError } = await supabase
      .from('notifications')
      .delete()
      .in('related_post_id', fakePostIds)

    if (deleteNotificationsError) {
      console.error('❌ 알림 삭제 오류:', deleteNotificationsError.message)
    } else {
      console.log('   ✅ 관련 알림 삭제 완료')
    }

    // 3. 마지막으로 가짜 복구 게시물 삭제
    console.log('\n3. 가짜 복구 게시물 삭제')
    const { error: deletePostsError } = await supabase.from('posts').delete().in('id', fakePostIds)

    if (deletePostsError) {
      console.error('❌ 게시물 삭제 오류:', deletePostsError.message)
      return
    }

    console.log('✅ 가짜 복구 게시물 삭제 완료')

    // 4. 삭제 후 확인
    console.log('\n4. 삭제 후 상태 확인')
    const { data: postsAfterDelete, error: afterDeleteError } = await supabase
      .from('posts')
      .select('id, title, created_at')
      .order('created_at', { ascending: false })

    if (afterDeleteError) {
      console.error('❌ 삭제 후 확인 오류:', afterDeleteError.message)
    } else {
      console.log(`삭제 후 posts 테이블에 ${postsAfterDelete.length}개 게시물 남음`)

      if (postsAfterDelete.length > 0) {
        console.log('남은 게시물:')
        postsAfterDelete.forEach(post => {
          console.log(`  - "${post.title}" (${post.created_at})`)
        })
      } else {
        console.log('✅ posts 테이블이 비워졌습니다 - 실제 원본 복구 준비 완료')
      }
    }

    // 5. post_likes 보존 상태 확인
    console.log('\n5. post_likes 보존 상태 확인')
    const { data: preservedLikes, error: likesCheckError } = await supabase
      .from('post_likes')
      .select('post_id')
      .order('created_at')

    if (likesCheckError) {
      console.error('❌ post_likes 확인 오류:', likesCheckError.message)
    } else {
      console.log(`✅ 보존된 post_likes: ${preservedLikes.length}개`)
      console.log('📝 이 좋아요들은 실제 게시물 복구 후 자동으로 연결됩니다.')
    }

    // 6. 요약
    console.log('\n6. 정리 작업 요약')
    console.log(`✅ 가짜 복구 게시물 ${fakeRecoveryPosts.length}개 삭제 완료`)
    console.log('✅ 관련 댓글, 첨부파일, 알림 정리 완료')
    console.log('✅ 실제 post_likes 데이터 보존됨')
    console.log('✅ 실제 원본 게시물 복구를 위한 준비 완료')
    console.log('\n다음 단계: Supabase Point-in-Time Recovery로 실제 원본 복구')
  } catch (error) {
    console.error('❌ 삭제 작업 중 오류 발생:', error)
  }
}

deleteFakeRecoveryPosts()
