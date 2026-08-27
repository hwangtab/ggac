// ⛔ 무해화됨 — Supabase→Turso 컷오버 잔재. **실행해도 즉시 중단된다.**
//
// 이 스크립트는 활동 추적 시스템을 "검증"한다면서 Supabase
// `user_activities`에 실제로 INSERT까지 하고, 끝에 `=== 검증 완료 ===`를 찍는다.
// 검증 스크립트가 버려진 사본에 초록불을 주는 것이 이 중에서 제일 나쁘다.
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
// 활동 로그의 권위는 Turso `user_activities`·`user_sessions`다
// (`src/db/schema/ops.ts`, 쿼리 계층 `src/db/queries/activities.ts`).
// Turso에는 RLS가 없다 — 활동 로깅 권한은 앱 계층
// (`src/utils/activityLogger.ts`)이 판정하므로 "RPC/정책이 동작하는가"는
// 더 이상 검증 대상이 아니다.
//
// 실행 흐름은 그대로 남겨 둔다(다시 필요해지면 포팅할 때 원본 로직이 필요하다).
console.error(
  '[중단] 이 스크립트는 Supabase `user_activities`를 읽고 쓰면서 "검증 완료"를 찍습니다. ' +
    '활동 로그의 권위는 Turso입니다 — 버려진 사본에 초록불을 주는 것이 제일 나쁩니다. ' +
    'src/db/queries/activities.ts 기준으로 포팅한 뒤에 쓰십시오.'
)
process.exit(1)
/**
 * 활동 추적 시스템 검증 스크립트
 * - 데이터베이스 테이블 존재 여부 확인
 * - RPC 함수 동작 확인
 * - 실제 데이터 존재 확인
 * - Service Role 키 설정 확인
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

async function verifyActivitySystem() {
  console.log('=== 활동 추적 시스템 검증 시작 ===\n')

  // Supabase 클라이언트 생성
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  console.log('1. 환경 변수 확인')
  console.log(`Supabase URL: ${supabaseUrl ? '✅ 설정됨' : '❌ 누락'}`)
  console.log(`Service Role Key: ${serviceRoleKey ? '✅ 설정됨' : '❌ 누락'}\n`)

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ 필수 환경 변수가 누락되었습니다.')
    return
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    // 2. 테이블 존재 확인
    console.log('2. 데이터베이스 테이블 존재 확인')

    const tables = ['user_activities', 'user_sessions', 'daily_activity_stats']

    for (const tableName of tables) {
      try {
        const { data, error } = await supabase.from(tableName).select('id').limit(1)

        if (error) {
          console.log(`❌ ${tableName}: ${error.message}`)
        } else {
          console.log(`✅ ${tableName}: 테이블 존재`)
        }
      } catch (err) {
        console.log(`❌ ${tableName}: ${err.message}`)
      }
    }

    // 3. RPC 함수 존재 확인
    console.log('\n3. RPC 함수 동작 확인')

    try {
      const { data, error } = await supabase.rpc('log_user_activity', {
        p_user_id: '00000000-0000-0000-0000-000000000000', // 더미 UUID
        p_action_type: 'page_viewed',
        p_target_type: 'system',
        p_target_id: null,
        p_metadata: { test: true },
        p_ip_address: '127.0.0.1',
        p_user_agent: 'Test Script',
      })

      if (error) {
        console.log(`❌ log_user_activity RPC: ${error.message}`)
      } else {
        console.log(`✅ log_user_activity RPC: 함수 존재 및 동작`)
      }
    } catch (err) {
      console.log(`❌ log_user_activity RPC: ${err.message}`)
    }

    try {
      const { data, error } = await supabase.rpc('manage_user_session', {
        p_user_id: '00000000-0000-0000-0000-000000000000',
        p_session_token: 'test_session',
        p_action: 'start',
        p_ip_address: '127.0.0.1',
        p_user_agent: 'Test Script',
      })

      if (error) {
        console.log(`❌ manage_user_session RPC: ${error.message}`)
      } else {
        console.log(`✅ manage_user_session RPC: 함수 존재 및 동작`)
      }
    } catch (err) {
      console.log(`❌ manage_user_session RPC: ${err.message}`)
    }

    // 4. 기존 데이터 확인
    console.log('\n4. 기존 활동 데이터 확인')

    try {
      const { data: activities, error } = await supabase
        .from('user_activities')
        .select('id, action_type, created_at')
        .order('created_at', { ascending: false })
        .limit(10)

      if (error) {
        console.log(`❌ user_activities 조회: ${error.message}`)
      } else {
        console.log(`✅ user_activities: ${activities.length}개 레코드 존재`)
        if (activities.length > 0) {
          console.log('최근 활동:')
          activities.forEach(activity => {
            console.log(`  - ${activity.action_type} at ${activity.created_at}`)
          })
        }
      }
    } catch (err) {
      console.log(`❌ user_activities 조회: ${err.message}`)
    }

    // 5. 전체 활동 통계
    console.log('\n5. 전체 활동 통계')

    try {
      const { data: stats, error } = await supabase.from('user_activities').select('action_type')

      if (error) {
        console.log(`❌ 활동 통계 조회: ${error.message}`)
      } else {
        const actionTypes = stats.reduce((acc, activity) => {
          acc[activity.action_type] = (acc[activity.action_type] || 0) + 1
          return acc
        }, {})

        console.log(`✅ 총 활동 수: ${stats.length}개`)
        console.log('활동 유형별:')
        Object.entries(actionTypes).forEach(([type, count]) => {
          console.log(`  - ${type}: ${count}개`)
        })
      }
    } catch (err) {
      console.log(`❌ 활동 통계 조회: ${err.message}`)
    }

    // 6. 회원 프로필 확인
    console.log('\n6. 활성 회원 확인')

    try {
      const { data: members, error } = await supabase
        .from('member_profiles')
        .select('id, display_name, registration_status, is_active')
        .eq('registration_status', 'approved')
        .eq('is_active', true)

      if (error) {
        console.log(`❌ 회원 조회: ${error.message}`)
      } else {
        console.log(`✅ 활성 회원: ${members.length}명`)
        members.forEach(member => {
          console.log(`  - ${member.display_name} (${member.id})`)
        })
      }
    } catch (err) {
      console.log(`❌ 회원 조회: ${err.message}`)
    }

    // 7. 리포트 생성 테스트용 쿼리
    console.log('\n7. 리포트 생성 쿼리 테스트')

    try {
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      const endDate = new Date()

      const { data: reportData, error } = await supabase
        .from('user_activities')
        .select(
          `
          id,
          user_id,
          action_type,
          created_at,
          member_profiles(display_name, email, registration_status)
        `
        )
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .limit(100)

      if (error) {
        console.log(`❌ 리포트 쿼리: ${error.message}`)
      } else {
        console.log(`✅ 리포트 데이터: ${reportData.length}개 활동 조회됨`)

        const uniqueUsers = new Set(reportData.map(d => d.user_id)).size
        console.log(`  - 활동한 고유 사용자: ${uniqueUsers}명`)

        const actionCounts = reportData.reduce((acc, activity) => {
          acc[activity.action_type] = (acc[activity.action_type] || 0) + 1
          return acc
        }, {})

        console.log('  - 활동 유형별 분포:')
        Object.entries(actionCounts).forEach(([type, count]) => {
          console.log(`    * ${type}: ${count}개`)
        })
      }
    } catch (err) {
      console.log(`❌ 리포트 쿼리: ${err.message}`)
    }

    console.log('\n=== 검증 완료 ===')
  } catch (error) {
    console.error('검증 중 오류 발생:', error)
  }
}

verifyActivitySystem()
