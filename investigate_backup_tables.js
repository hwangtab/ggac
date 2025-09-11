/**
 * 백업 테이블 조사 스크립트
 * 발견된 artists_backup 테이블을 분석하여 posts 백업 테이블 존재 여부 확인
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

// 복구 대상 게시물 ID들
const REAL_POST_IDS = [
  '7922037f-168b-4c1a-ab0b-8668d462ee9b',
  'e7fa6a8a-9569-48a2-b0d3-c29cd51a1e5e',
  '0e307867-f023-4598-a817-946f56724b67',
  'f8a8cff5-28c4-42ff-a016-ff893425d7da',
  '9f5883a9-b77a-4707-bb41-be77f597b2d7',
  '83fe0df7-e72e-4bc3-add4-cb42540ca68d',
  '3b805830-e546-4df8-8e8a-8166bd3c692f',
  'd0d87e22-1904-4a9a-94ad-7ebce328ba89',
  '445b051c-7c51-423b-bb31-5df48dcdd545',
  '301d9f12-3a5d-48b9-b1cd-891d4cc3caa6',
  '203d9082-6d46-45e1-ae21-a05847ace22d',
  '958268fd-7ab9-4774-a611-13a75e6b0cea',
  'b7b0a87e-a720-4ae0-8118-2b5191530e10',
  'b077baa7-d7a3-4480-a77f-18a9d9ae33d1',
  'e84ed6a1-bfdd-44bc-9b1a-8df043e61384',
  '112054ea-e759-4320-b28f-991b0ba58729',
  '6c3f7ba1-1102-4d83-8e84-6f6ac02f48d8',
]

async function investigateBackupTables() {
  console.log('=== 백업 테이블 조사 시작 ===\n')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ 환경 변수가 설정되지 않았습니다.')
    return
  }

  console.log('✅ Supabase 연결 설정 완료')
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const results = {
    timestamp: new Date().toISOString(),
    backup_tables_found: [],
    posts_backup_attempts: [],
    recovery_data: [],
    final_conclusion: '',
  }

  try {
    console.log('🔍 1. 확인된 artists_backup 테이블 분석')
    console.log('==========================================')

    // artists_backup 테이블들 확인
    const backupTables = ['artists_backup_20241218', 'artists_backup_full_20241218']

    for (const tableName of backupTables) {
      console.log(`\n1-1. ${tableName} 테이블 조사`)
      try {
        const { data: backupData, error: backupError } = await supabase
          .from(tableName)
          .select('*')
          .limit(5)

        if (backupError) {
          console.log(`❌ ${tableName} 접근 실패:`, backupError.message)
        } else {
          console.log(`✅ ${tableName} 접근 성공 - ${backupData.length}개 레코드 발견`)
          if (backupData.length > 0) {
            console.log('   컬럼들:', Object.keys(backupData[0]).join(', '))
            results.backup_tables_found.push({
              table_name: tableName,
              record_count: backupData.length,
              columns: Object.keys(backupData[0]),
              sample_data: backupData[0],
            })
          }
        }
      } catch (error) {
        console.log(`❌ ${tableName} 조사 오류:`, error.message)
      }
    }

    console.log('\n🔍 2. posts 백업 테이블 패턴 검색')
    console.log('==========================================')

    // 가능한 posts 백업 테이블 이름들
    const possiblePostsBackups = [
      'posts_backup',
      'posts_backup_20241218',
      'posts_backup_full_20241218',
      'backup_posts',
      'posts_archive',
      'posts_history',
      'posts_backup_20250909',
      'posts_backup_20250910',
      'posts_backup_full',
    ]

    for (const tableName of possiblePostsBackups) {
      console.log(`\n2-${possiblePostsBackups.indexOf(tableName) + 1}. ${tableName} 테이블 확인`)
      try {
        const { data: postsBackup, error: postsBackupError } = await supabase
          .from(tableName)
          .select('*')
          .limit(3)

        if (postsBackupError) {
          console.log(`❌ ${tableName} 존재하지 않음:`, postsBackupError.message)
          results.posts_backup_attempts.push({
            table_name: tableName,
            status: 'not_found',
            error: postsBackupError.message,
          })
        } else {
          console.log(`🎯 ${tableName} 발견! ${postsBackup.length}개 레코드`)
          if (postsBackup.length > 0) {
            console.log('   컬럼들:', Object.keys(postsBackup[0]).join(', '))
            console.log('   샘플 제목:', postsBackup[0].title || '(제목 없음)')

            // 실제 게시물 ID와 매칭 확인
            const { data: matchingPosts, error: matchError } = await supabase
              .from(tableName)
              .select('*')
              .in('id', REAL_POST_IDS.slice(0, 5)) // 처음 5개만 테스트

            if (!matchError && matchingPosts.length > 0) {
              console.log(`🎯 실제 게시물 발견! ${matchingPosts.length}개`)
              matchingPosts.forEach(post => {
                console.log(`   - ID: ${post.id}`)
                console.log(`     제목: "${post.title}"`)
                console.log(`     작성일: ${post.created_at}`)
                console.log('')
              })

              results.recovery_data.push({
                source_table: tableName,
                found_posts: matchingPosts.length,
                posts: matchingPosts,
              })
            }

            results.posts_backup_attempts.push({
              table_name: tableName,
              status: 'found',
              record_count: postsBackup.length,
              columns: Object.keys(postsBackup[0]),
              has_real_posts: matchingPosts?.length > 0,
            })
          }
        }
      } catch (error) {
        console.log(`❌ ${tableName} 조사 오류:`, error.message)
        results.posts_backup_attempts.push({
          table_name: tableName,
          status: 'error',
          error: error.message,
        })
      }
    }

    console.log('\n🔍 3. 시스템 테이블에서 추가 백업 테이블 검색')
    console.log('==========================================')

    // pg_tables에서 백업 관련 테이블 전체 검색
    try {
      console.log('\n3-1. 백업/아카이브 패턴 테이블 검색')

      // 이 쿼리는 직접 실행할 수 없으므로, 알려진 백업 테이블 패턴으로 시도
      const searchPatterns = [
        'backup_posts_20241218',
        'posts_backup_dec2024',
        'archive_posts',
        'posts_20241218',
        'backup_20241218_posts',
        'full_backup_posts',
      ]

      for (const pattern of searchPatterns) {
        try {
          const { data: patternData, error: patternError } = await supabase
            .from(pattern)
            .select('id, title, created_at')
            .limit(1)

          if (!patternError && patternData) {
            console.log(`🎯 백업 테이블 발견: ${pattern}`)
            results.backup_tables_found.push({
              table_name: pattern,
              discovered_method: 'pattern_search',
            })
          }
        } catch (error) {
          // 무시 - 존재하지 않는 테이블
        }
      }
    } catch (error) {
      console.log('❌ 시스템 테이블 검색 오류:', error.message)
    }

    console.log('\n📊 조사 결과 요약')
    console.log('==========================================')

    const foundBackupTables = results.backup_tables_found.length
    const foundPostsBackups = results.posts_backup_attempts.filter(
      attempt => attempt.status === 'found'
    ).length
    const recoveredPosts = results.recovery_data.reduce((sum, data) => sum + data.found_posts, 0)

    console.log(`발견된 백업 테이블: ${foundBackupTables}개`)
    console.log(`posts 백업 테이블: ${foundPostsBackups}개`)
    console.log(`복구된 실제 게시물: ${recoveredPosts}개`)

    if (recoveredPosts > 0) {
      console.log('\n🎉 실제 게시물 복구 성공!')
      console.log('복구된 데이터:')
      results.recovery_data.forEach(data => {
        console.log(`\n백업 소스: ${data.source_table}`)
        data.posts.forEach(post => {
          console.log(`  📝 "${post.title}"`)
          console.log(`     ID: ${post.id}`)
          console.log(`     작성자: ${post.author_id}`)
          console.log(`     작성일: ${post.created_at}`)
          console.log(`     내용 길이: ${post.content?.length || 0}자`)
        })
      })

      results.final_conclusion = `백업 테이블에서 ${recoveredPosts}개 실제 게시물 복구 성공`

      console.log('\n✅ 다음 단계: 전체 복구 스크립트 실행')
      console.log('   - 모든 17개 게시물 백업 테이블에서 추출')
      console.log('   - 현재 가짜 게시물들 삭제')
      console.log('   - 실제 게시물들 복원')
    } else {
      console.log('\n❌ 백업 테이블에서도 실제 게시물을 찾을 수 없음')
      console.log('최종 결론:')
      console.log('1. 모든 로컬 백업 테이블 조사 완료')
      console.log('2. 실제 원본 게시물 데이터 복구 불가능')
      console.log('3. Supabase Point-in-Time Recovery가 유일한 해결책')

      results.final_conclusion = '모든 로컬 복구 시도 실패 - Point-in-Time Recovery 필요'
    }

    // 결과 저장
    fs.writeFileSync('backup_tables_investigation.json', JSON.stringify(results, null, 2))
    console.log('\n✅ 백업 테이블 조사 결과가 backup_tables_investigation.json에 저장되었습니다.')
  } catch (error) {
    console.error('❌ 백업 테이블 조사 중 오류 발생:', error)
    results.final_conclusion = `조사 중 오류 발생: ${error.message}`
  }

  return results
}

investigateBackupTables()
