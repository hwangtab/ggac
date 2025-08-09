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
        const { data, error } = await supabase
          .from(tableName)
          .select('id')
          .limit(1)
        
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
        p_user_agent: 'Test Script'
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
        p_user_agent: 'Test Script'
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
      const { data: stats, error } = await supabase
        .from('user_activities')
        .select('action_type')
      
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
        .select(`
          id,
          user_id,
          action_type,
          created_at,
          member_profiles(display_name, email, registration_status)
        `)
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