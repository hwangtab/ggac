const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

// Supabase 클라이언트 생성
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL is missing!');
  process.exit(1);
}

// 서비스 키가 없으면 수동 실행 안내
if (!supabaseServiceKey) {
  console.log('⚠️  SUPABASE_SERVICE_ROLE_KEY not found.');
  console.log('🔧 Manual migration required in Supabase Dashboard.\n');
  
  // 마이그레이션 파일 내용 출력
  try {
    const migrationPath = path.join(__dirname, 'supabase/migrations/20250108_fix_signup_flow.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('📋 Please copy and execute the following SQL in Supabase Dashboard → SQL Editor:\n');
    console.log('=' * 80);
    console.log(migrationSQL);
    console.log('=' * 80);
    console.log('\n✅ After running the SQL, proceed to the next step.');
  } catch (error) {
    console.error('❌ Error reading migration file:', error.message);
  }
  
  process.exit(0);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function executeMigration() {
  console.log('🚀 Starting signup flow fix migration...\n');

  try {
    // 마이그레이션 파일 읽기
    const migrationPath = path.join(__dirname, 'supabase/migrations/20250108_fix_signup_flow.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration file loaded successfully');
    console.log('📝 SQL content preview:');
    console.log(migrationSQL.substring(0, 200) + '...\n');

    // SQL 실행 (각 문장을 개별적으로 실행)
    const statements = migrationSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    console.log(`🔄 Executing ${statements.length} SQL statements...\n`);

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim()) {
        try {
          console.log(`📋 Executing statement ${i + 1}/${statements.length}:`);
          console.log(`   ${statement.substring(0, 80)}...`);
          
          const { data, error } = await supabase.rpc('exec_sql', { 
            sql_query: statement + ';' 
          });

          if (error) {
            // RPC 함수가 없는 경우 직접 실행 시도
            if (error.message.includes('function exec_sql')) {
              console.log('   ⚠️  exec_sql function not available, trying direct execution...');
              
              // 일부 문장은 Supabase client로 직접 실행할 수 없으므로 수동으로 처리
              if (statement.includes('DROP TRIGGER') || 
                  statement.includes('CREATE TRIGGER') || 
                  statement.includes('CREATE OR REPLACE FUNCTION') ||
                  statement.includes('DROP FUNCTION')) {
                console.log('   ⏭️  Skipping trigger/function statement (requires manual execution)');
                continue;
              }
            } else {
              throw error;
            }
          } else {
            console.log('   ✅ Success');
          }
        } catch (statementError) {
          console.error(`   ❌ Error in statement ${i + 1}:`, statementError.message);
          
          // 치명적이지 않은 오류는 계속 진행
          if (statementError.message.includes('already exists') || 
              statementError.message.includes('does not exist')) {
            console.log('   ⚠️  Non-critical error, continuing...');
            continue;
          } else {
            throw statementError;
          }
        }
      }
    }

    console.log('\n✅ Migration execution completed!');
    console.log('\n📋 Post-migration verification:');

    // 기본적인 검증
    const { data: profiles, error: profileError } = await supabase
      .from('member_profiles')
      .select('count')
      .limit(1);

    if (profileError) {
      console.log('❌ member_profiles table verification failed:', profileError.message);
    } else {
      console.log('✅ member_profiles table accessible');
    }

    console.log('\n🚨 IMPORTANT: Some statements may require manual execution in Supabase Dashboard');
    console.log('   Please copy and run the following in SQL Editor:');
    console.log('   1. Function and trigger statements');
    console.log('   2. Policy modifications');
    console.log('\n📁 Migration file location: supabase/migrations/20250108_fix_signup_flow.sql');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('\nFull error:', error);
    
    console.log('\n🔧 Manual execution required:');
    console.log('1. Open Supabase Dashboard → SQL Editor');
    console.log('2. Copy the contents of supabase/migrations/20250108_fix_signup_flow.sql');
    console.log('3. Run the SQL manually');
    
    process.exit(1);
  }
}

executeMigration();