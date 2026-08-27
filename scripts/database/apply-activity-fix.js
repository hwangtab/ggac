#!/usr/bin/env node
// ⛔ 무해화됨 — Supabase→Turso 컷오버 잔재. **실행해도 즉시 중단된다.**
//
// 이 스크립트는 Supabase `user_activities`에 RLS INSERT 정책을 만들려 한다
// (exec_sql RPC가 없으면 대시보드에 붙여넣을 SQL만 출력한다).
// `docs/login-fix-deployment.md`가 로그인 500의 처방으로 이 파일을 지목하고
// 있었다(같은 커밋에서 수정).
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
// **Turso에는 RLS가 없다.** 활동 로깅 권한은 앱 계층이 판정한다
// (`src/utils/activityLogger.ts`, `src/db/queries/activities.ts`).
// 로그인 시 500이 다시 나면 RLS 정책이 아니라 그 경로와 Vercel 런타임
// 로그를 봐야 한다.
//
// 실행 흐름은 그대로 남겨 둔다(다시 필요해지면 포팅할 때 원본 로직이 필요하다).
console.error(
  '[중단] 이 스크립트는 Supabase에 RLS 정책을 만듭니다. Turso에는 RLS가 없고 ' +
    '활동 로깅 권한은 앱 계층(src/utils/activityLogger.ts)이 판정합니다 — ' +
    '로그인 500의 처방이 아닙니다.'
)
process.exit(1)
/**
 * Apply Activity Logging RLS Fix via Supabase Service Role
 *
 * This script applies the migration to fix the activity logging INSERT policy issue.
 * Run this with: node scripts/database/apply-activity-fix.js
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing environment variables:')
  console.error('  NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '✓' : '✗')
  console.error('  SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? '✓' : '✗')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

async function applyMigration() {
  console.log('🔧 Applying Activity Logging RLS Fix Migration...\n')

  // SQL to execute
  const sql = `
-- Fix Activity Logging RLS Policy Issue
-- Date: 2025-01-14
-- Problem: user_activities table has SELECT policy only, no INSERT policy

-- Add INSERT policy for authenticated users to log their own activities
CREATE POLICY IF NOT EXISTS "Allow authenticated users to log activities" ON user_activities
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
`

  try {
    // Execute the SQL using rpc (we'll use a custom approach)
    console.log('📝 Executing SQL...\n')
    console.log(sql)
    console.log('\n')

    // Use the admin client to execute raw SQL
    const { data, error } = await supabase
      .rpc('exec_sql', {
        sql_query: sql,
      })
      .catch(async rpcError => {
        // If exec_sql doesn't exist, we need to use the REST API directly
        console.log('⚠️  exec_sql RPC not available, using direct SQL execution...\n')

        // Split SQL into individual statements
        const createPolicy = sql.trim()

        // We can't execute raw SQL directly, so we'll provide instructions
        console.log('📋 MANUAL EXECUTION REQUIRED:\n')
        console.log('Please execute the following SQL in Supabase Dashboard > SQL Editor:\n')
        console.log('---SQL START---')
        console.log(createPolicy)
        console.log('---SQL END---\n')
        console.log(
          'Or visit: https://supabase.com/dashboard/project/btugywkltavbogdnhwpu/sql/new\n'
        )

        return { manual: true }
      })

    if (data && data.manual) {
      console.log('✅ Migration SQL prepared. Please execute manually.')
      console.log(
        '\n📍 File location: supabase/migrations/20250114000000_fix_activity_logging_rls.sql'
      )
      return
    }

    if (error) {
      console.error('❌ Error applying migration:', error)
      process.exit(1)
    }

    console.log('✅ Migration applied successfully!')
    console.log('\n🔍 Verifying policy creation...')

    // Verify the policy was created
    const { data: policies, error: policyError } = await supabase
      .from('pg_policies')
      .select('*')
      .eq('tablename', 'user_activities')
      .eq('policyname', 'Allow authenticated users to log activities')

    if (policyError) {
      console.warn('⚠️  Could not verify policy (this is okay):', policyError.message)
    } else if (policies && policies.length > 0) {
      console.log('✅ Policy verified: "Allow authenticated users to log activities"')
    }

    console.log('\n🎉 Activity logging fix complete!')
    console.log('   Users should now be able to log in without 500 errors.\n')
  } catch (error) {
    console.error('❌ Unexpected error:', error)
    process.exit(1)
  }
}

// Run the migration
applyMigration()
  .then(() => {
    console.log('Done.')
    process.exit(0)
  })
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
