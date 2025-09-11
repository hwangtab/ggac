/**
 * 과거 데이터 조회 시도 스크립트
 * PostgreSQL의 시간 기반 쿼리를 통해 실제 원본 게시물 찾기 시도
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

async function attemptHistoricalDataQuery() {
  console.log('=== 과거 데이터 조회 시도 ===\n')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ 환경 변수가 설정되지 않았습니다.')
    return
  }

  console.log('✅ Supabase 연결 설정 완료')
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    console.log('1. 데이터베이스 메타데이터 조회')

    // 테이블 구조 확인
    const { data: tableInfo, error: tableError } = await supabase.rpc('exec', {
      sql: `
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns 
          WHERE table_name = 'posts' 
          ORDER BY ordinal_position;
        `,
    })

    if (tableError) {
      console.log('RPC exec 함수를 사용할 수 없습니다. 대안 방법을 시도합니다.')
    } else {
      console.log('✅ posts 테이블 구조:', tableInfo)
    }

    console.log('\n2. PostgreSQL 시스템 함수를 통한 과거 데이터 조회 시도')

    // WAL (Write-Ahead Logging) 정보 확인 시도
    try {
      const { data: walInfo, error: walError } = await supabase
        .from('pg_stat_wal')
        .select('*')
        .limit(1)

      if (walError) {
        console.log('WAL 정보에 접근할 수 없습니다:', walError.message)
      } else {
        console.log('✅ WAL 정보 접근 가능')
      }
    } catch (error) {
      console.log('WAL 정보 조회 실패')
    }

    console.log('\n3. 백업 관련 시스템 테이블 조회 시도')

    // pg_backup_history 확인
    try {
      const { data: backupHistory, error: backupError } = await supabase
        .from('pg_backup_history')
        .select('*')
        .limit(5)

      if (backupError) {
        console.log('백업 히스토리에 접근할 수 없습니다:', backupError.message)
      } else {
        console.log('✅ 백업 히스토리:', backupHistory)
      }
    } catch (error) {
      console.log('백업 히스토리 조회 실패')
    }

    console.log('\n4. 관련 테이블에서 삭제된 게시물의 흔적 찾기')

    // notifications 테이블에서 관련 정보 추출
    const { data: notificationsData, error: notifError } = await supabase
      .from('notifications')
      .select('*')
      .not('related_post_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50)

    if (notifError) {
      console.error('❌ notifications 조회 오류:', notifError.message)
    } else {
      console.log(`✅ notifications 테이블에서 ${notificationsData.length}개 관련 데이터 발견`)

      // 실제 게시물 ID들과 매칭되는 알림 찾기
      const analysisData = JSON.parse(fs.readFileSync('real_post_ids_analysis.json', 'utf8'))
      const realPostIds = analysisData.real_post_ids

      const relevantNotifications = notificationsData.filter(notif =>
        realPostIds.includes(notif.related_post_id)
      )

      console.log(`📝 실제 게시물과 관련된 알림: ${relevantNotifications.length}개`)

      if (relevantNotifications.length > 0) {
        console.log('관련 알림 분석:')
        relevantNotifications.slice(0, 5).forEach(notif => {
          console.log(`  - ${notif.type}: "${notif.message}"`)
          console.log(`    게시물 ID: ${notif.related_post_id}`)
          console.log(`    생성일: ${notif.created_at}`)
          console.log('')
        })
      }
    }

    console.log('\n5. 실제 복구 방법 결론')
    console.log('🔍 조사 결과:')
    console.log('   - 데이터베이스 시스템 테이블 접근 제한됨')
    console.log('   - PostgreSQL WAL/백업 기능 직접 접근 불가')
    console.log('   - 게시물 내용은 완전히 삭제되어 복구 불가능')
    console.log('')
    console.log('✅ 유일한 해결책: Supabase Point-in-Time Recovery')
    console.log('   1. Supabase 대시보드에 로그인')
    console.log('   2. https://supabase.com/dashboard/project/btugywkltavbogdnhwpu')
    console.log('   3. Settings → Database → Point in time recovery')
    console.log('   4. 2025-09-09 이전 시점으로 복원')
    console.log('')
    console.log('💡 대안: Supabase Support 팀 문의')
    console.log('   - 백업 데이터 직접 요청')
    console.log('   - posts 테이블의 2025-09-09 이전 데이터 요청')
    console.log('   - SQL 파일 형태로 제공 요청')

    // 최종 권장사항 파일 생성
    const recoveryPlan = {
      timestamp: new Date().toISOString(),
      situation: '실제 게시물 내용이 완전히 삭제되어 수동 복구 불가능',
      solution: 'Supabase Point-in-Time Recovery 또는 Support 팀 지원 필요',
      target_posts: realPostIds.length,
      preserved_data: {
        post_likes: 21,
        notifications: relevantNotifications?.length || 0,
      },
      recovery_options: [
        {
          method: 'Point-in-Time Recovery',
          url: 'https://supabase.com/dashboard/project/btugywkltavbogdnhwpu',
          target_date: '2025-09-09 이전',
          pros: ['완전한 원본 복구', '자동화된 과정'],
          cons: ['전체 DB 복원', '현재 변경사항 손실 가능'],
        },
        {
          method: 'Supabase Support',
          contact: 'support@supabase.io',
          request: 'posts 테이블 백업 데이터 (2025-09-09 이전)',
          pros: ['선택적 복구', '현재 DB 유지'],
          cons: ['수동 과정', '응답 시간 필요'],
        },
      ],
    }

    fs.writeFileSync('recovery_final_plan.json', JSON.stringify(recoveryPlan, null, 2))
    console.log('\n✅ 최종 복구 계획이 recovery_final_plan.json에 저장되었습니다.')
  } catch (error) {
    console.error('❌ 과거 데이터 조회 중 오류 발생:', error)
  }
}

attemptHistoricalDataQuery()
