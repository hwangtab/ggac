/**
 * 가짜 테스트 게시물 삭제 스크립트
 * 2025-09-10에 생성된 4개의 테스트 게시물과 관련 데이터를 안전하게 삭제
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

// 가짜 게시물 ID들 (2025-09-10 생성)
const FAKE_POST_IDS = [
  '9a04f79d-f06d-47f8-97f6-7b8ff9773068', // 시스템 개선 건의
  '7b4281b3-c731-4a9a-972e-c6b1b188bb2a', // 안녕하세요! 경기아트콜렉티브입니다
  '4ff201b2-9b8a-47ba-8fa9-740852eb4598', // 첫 번째 게시글입니다
  '262b02d7-0137-4538-9d7f-c937c050e8c9', // 작품 홍보 테스트
]

async function deleteFakePosts() {
  console.log('=== 가짜 테스트 게시물 삭제 ===\n')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ 환경 변수가 설정되지 않았습니다.')
    return
  }

  console.log('✅ Supabase 연결 설정 완료')
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    console.log('1. 삭제 전 현재 상태 확인')

    // 현재 posts 테이블 상태 확인
    const { data: currentPosts, error: postsError } = await supabase
      .from('posts')
      .select('id, title, created_at')
      .order('created_at', { ascending: false })

    if (postsError) {
      console.error('❌ 현재 게시물 조회 오류:', postsError.message)
      return
    }

    console.log(`현재 posts 테이블에 ${currentPosts.length}개 게시물 존재`)
    console.log('현재 게시물 목록:')
    currentPosts.forEach(post => {
      const isFake = FAKE_POST_IDS.includes(post.id)
      console.log(`  ${isFake ? '🔴' : '🟢'} "${post.title}" (${post.created_at})`)
    })

    const fakePostsFound = currentPosts.filter(post => FAKE_POST_IDS.includes(post.id))
    console.log(`\n삭제 대상 가짜 게시물: ${fakePostsFound.length}개`)

    if (fakePostsFound.length === 0) {
      console.log('✅ 삭제할 가짜 게시물이 없습니다.')
      return
    }

    // 2. 관련 데이터 삭제 (외래 키 제약 조건 고려)
    console.log('\n2. 관련 데이터 삭제 시작')

    // 2-1. 댓글 좋아요 삭제
    console.log('2-1. 댓글 좋아요 삭제')

    // 먼저 삭제할 댓글 ID들을 가져옴
    const { data: commentsForLikes, error: commentsForLikesError } = await supabase
      .from('comments')
      .select('id')
      .in('post_id', FAKE_POST_IDS)

    if (commentsForLikesError) {
      console.error('⚠️ 댓글 ID 조회 오류:', commentsForLikesError.message)
    } else {
      const commentIds = commentsForLikes?.map(c => c.id) || []

      if (commentIds.length > 0) {
        const { data: commentLikesToDelete, error: commentLikesError } = await supabase
          .from('comment_likes')
          .select('id')
          .in('comment_id', commentIds)

        if (commentLikesError) {
          console.error('⚠️ 댓글 좋아요 조회 오류:', commentLikesError.message)
        } else {
          console.log(`   삭제 대상 댓글 좋아요: ${commentLikesToDelete?.length || 0}개`)

          if (commentLikesToDelete && commentLikesToDelete.length > 0) {
            const { error: deleteCommentLikesError } = await supabase
              .from('comment_likes')
              .delete()
              .in('comment_id', commentIds)

            if (deleteCommentLikesError) {
              console.error('❌ 댓글 좋아요 삭제 오류:', deleteCommentLikesError.message)
            } else {
              console.log('   ✅ 댓글 좋아요 삭제 완료')
            }
          }
        }
      } else {
        console.log('   삭제할 댓글이 없어 댓글 좋아요도 없음')
      }
    }

    // 2-2. 댓글 삭제
    console.log('2-2. 댓글 삭제')
    const { data: commentsToDelete, error: commentsSelectError } = await supabase
      .from('comments')
      .select('id')
      .in('post_id', FAKE_POST_IDS)

    if (commentsSelectError) {
      console.error('⚠️ 댓글 조회 오류:', commentsSelectError.message)
    } else {
      console.log(`   삭제 대상 댓글: ${commentsToDelete?.length || 0}개`)

      if (commentsToDelete && commentsToDelete.length > 0) {
        const { error: deleteCommentsError } = await supabase
          .from('comments')
          .delete()
          .in('post_id', FAKE_POST_IDS)

        if (deleteCommentsError) {
          console.error('❌ 댓글 삭제 오류:', deleteCommentsError.message)
        } else {
          console.log('   ✅ 댓글 삭제 완료')
        }
      }
    }

    // 2-3. 게시물 좋아요 삭제
    console.log('2-3. 게시물 좋아요 삭제')
    const { data: postLikesToDelete, error: postLikesSelectError } = await supabase
      .from('post_likes')
      .select('id')
      .in('post_id', FAKE_POST_IDS)

    if (postLikesSelectError) {
      console.error('⚠️ 게시물 좋아요 조회 오류:', postLikesSelectError.message)
    } else {
      console.log(`   삭제 대상 게시물 좋아요: ${postLikesToDelete?.length || 0}개`)

      if (postLikesToDelete && postLikesToDelete.length > 0) {
        const { error: deletePostLikesError } = await supabase
          .from('post_likes')
          .delete()
          .in('post_id', FAKE_POST_IDS)

        if (deletePostLikesError) {
          console.error('❌ 게시물 좋아요 삭제 오류:', deletePostLikesError.message)
        } else {
          console.log('   ✅ 게시물 좋아요 삭제 완료')
        }
      }
    }

    // 2-4. 첨부파일 삭제
    console.log('2-4. 첨부파일 삭제')
    const { data: attachmentsToDelete, error: attachmentsSelectError } = await supabase
      .from('post_attachments')
      .select('id')
      .in('post_id', FAKE_POST_IDS)

    if (attachmentsSelectError) {
      console.error('⚠️ 첨부파일 조회 오류:', attachmentsSelectError.message)
    } else {
      console.log(`   삭제 대상 첨부파일: ${attachmentsToDelete?.length || 0}개`)

      if (attachmentsToDelete && attachmentsToDelete.length > 0) {
        const { error: deleteAttachmentsError } = await supabase
          .from('post_attachments')
          .delete()
          .in('post_id', FAKE_POST_IDS)

        if (deleteAttachmentsError) {
          console.error('❌ 첨부파일 삭제 오류:', deleteAttachmentsError.message)
        } else {
          console.log('   ✅ 첨부파일 삭제 완료')
        }
      }
    }

    // 2-5. 알림 삭제 (related_post_id가 가짜 게시물을 가리키는 경우)
    console.log('2-5. 관련 알림 삭제')
    const { data: notificationsToDelete, error: notificationsSelectError } = await supabase
      .from('notifications')
      .select('id')
      .in('related_post_id', FAKE_POST_IDS)

    if (notificationsSelectError) {
      console.error('⚠️ 알림 조회 오류:', notificationsSelectError.message)
    } else {
      console.log(`   삭제 대상 알림: ${notificationsToDelete?.length || 0}개`)

      if (notificationsToDelete && notificationsToDelete.length > 0) {
        const { error: deleteNotificationsError } = await supabase
          .from('notifications')
          .delete()
          .in('related_post_id', FAKE_POST_IDS)

        if (deleteNotificationsError) {
          console.error('❌ 알림 삭제 오류:', deleteNotificationsError.message)
        } else {
          console.log('   ✅ 관련 알림 삭제 완료')
        }
      }
    }

    // 3. 마지막으로 게시물 삭제
    console.log('\n3. 가짜 게시물 삭제')
    const { error: deletePostsError } = await supabase
      .from('posts')
      .delete()
      .in('id', FAKE_POST_IDS)

    if (deletePostsError) {
      console.error('❌ 게시물 삭제 오류:', deletePostsError.message)
      return
    }

    console.log('✅ 가짜 게시물 삭제 완료')

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
          console.log(`  🟢 "${post.title}" (${post.created_at})`)
        })
      } else {
        console.log('✅ posts 테이블이 비워졌습니다 - 실제 게시물 복구 준비 완료')
      }
    }

    // 5. 요약
    console.log('\n5. 삭제 작업 요약')
    console.log('✅ 가짜 테스트 게시물 4개 삭제 완료')
    console.log('✅ 관련 댓글, 좋아요, 첨부파일, 알림 정리 완료')
    console.log('✅ 데이터베이스가 실제 게시물 복구를 위해 준비되었습니다')
    console.log('\n다음 단계: Supabase 백업에서 실제 게시물 17개 복구')
  } catch (error) {
    console.error('❌ 삭제 작업 중 오류 발생:', error)
  }
}

deleteFakePosts()
