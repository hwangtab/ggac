// ⛔ 무해화됨 — Supabase→Turso 컷오버 잔재. **실행해도 즉시 중단된다.**
//
// Supabase `member_profiles`의 컬럼 구성을 조회해 보고한다.
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
// 회원 테이블 컬럼 확인 스크립트
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://your-project.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'your-service-key'

if (!supabaseUrl.includes('supabase.co') || !supabaseServiceKey.startsWith('eyJ')) {
  console.log('⚠️  환경변수 설정이 필요합니다:')
  console.log('NEXT_PUBLIC_SUPABASE_URL=your-supabase-url')
  console.log('SUPABASE_SERVICE_ROLE_KEY=your-service-key')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function verifyMemberColumns() {
  try {
    console.log('🔍 member_profiles 테이블 컬럼 확인 중...\n')

    // 테이블 스키마 확인
    const { data: columns, error } = await supabase
      .from('information_schema.columns')
      .select('column_name, data_type, is_nullable, column_default')
      .eq('table_name', 'member_profiles')
      .eq('table_schema', 'public')

    if (error) {
      console.error('❌ 스키마 조회 오류:', error)
      return
    }

    console.log('📋 member_profiles 테이블 컬럼 목록:')
    console.log('─'.repeat(80))

    const requiredColumns = [
      'approved_by',
      'approved_at',
      'rejected_by',
      'is_suspended',
      'suspension_reason',
      'suspension_until',
    ]

    let missingColumns = []
    let existingColumns = []

    columns.forEach(col => {
      const isRequired = requiredColumns.includes(col.column_name)
      const status = isRequired ? '✅ 필수' : '   일반'
      console.log(
        `${status} ${col.column_name.padEnd(25)} ${col.data_type.padEnd(20)} ${col.is_nullable}`
      )

      if (isRequired) {
        existingColumns.push(col.column_name)
      }
    })

    // 누락된 컬럼 확인
    missingColumns = requiredColumns.filter(col => !existingColumns.includes(col))

    console.log('\n📊 컬럼 검증 결과:')
    console.log('─'.repeat(50))

    if (missingColumns.length === 0) {
      console.log('✅ 모든 필수 컬럼이 존재합니다!')
      existingColumns.forEach(col => {
        console.log(`   ✅ ${col}`)
      })
    } else {
      console.log('❌ 누락된 컬럼:')
      missingColumns.forEach(col => {
        console.log(`   ❌ ${col}`)
      })
      console.log('❌ 존재하는 컬럼:')
      existingColumns.forEach(col => {
        console.log(`   ✅ ${col}`)
      })
    }

    // 샘플 데이터 확인
    console.log('\n🧪 샘플 회원 데이터 확인:')
    console.log('─'.repeat(50))

    const { data: members, error: memberError } = await supabase
      .from('member_profiles')
      .select(
        `
        id, display_name, registration_status, is_active, 
        approved_by, approved_at, rejected_by, 
        is_suspended, suspension_reason, suspension_until
      `
      )
      .limit(3)

    if (memberError) {
      console.error('❌ 회원 데이터 조회 오류:', memberError)
    } else {
      members.forEach(member => {
        console.log(`👤 ${member.display_name} (${member.registration_status})`)
        console.log(`   approved_by: ${member.approved_by || 'null'}`)
        console.log(`   approved_at: ${member.approved_at || 'null'}`)
        console.log(`   rejected_by: ${member.rejected_by || 'null'}`)
        console.log(`   is_suspended: ${member.is_suspended}`)
        console.log('')
      })
    }

    // API 테스트
    console.log('🧪 API 접근 테스트:')
    console.log('─'.repeat(50))

    const testResponse = await fetch(
      `${supabaseUrl.replace('supabase.co', 'supabase.co')}/rest/v1/member_profiles?select=id,display_name&limit=1`,
      {
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
        },
      }
    )

    if (testResponse.ok) {
      console.log('✅ Supabase API 접근 성공')
    } else {
      console.log('❌ Supabase API 접근 실패:', testResponse.status)
    }
  } catch (error) {
    console.error('❌ 검증 중 오류 발생:', error)
  }
}

verifyMemberColumns()
