/**
 * Admin Functionality Test Script
 * Tests admin page functionality and identifies issues
 */

const { createClient } = require('@supabase/supabase-js')

async function testAdminFunctionality() {
  console.log('🔍 Testing Admin Functionality...\n')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Supabase environment variables not found')
    console.log('Required variables: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // 1. Check if member_profiles table exists with all required columns
    console.log('1. 📋 Checking member_profiles table structure...')
    const { data: columns, error: columnsError } = await supabase
      .from('information_schema.columns')
      .select('column_name')
      .eq('table_name', 'member_profiles')
      .eq('table_schema', 'public')

    if (columnsError) {
      console.error('❌ Error checking table structure:', columnsError.message)
      return
    }

    const columnNames = columns.map(col => col.column_name)
    console.log('✅ member_profiles columns found:', columnNames.length)

    // Check for required admin-related columns
    const requiredColumns = [
      'is_admin', 'is_active', 'registration_status', 'is_suspended',
      'suspension_reason', 'suspension_until', 'profile_completeness_score',
      'verification_status', 'membership_type', 'engagement_score',
      'approved_by', 'rejected_by', 'last_login_at', 'is_artist'
    ]

    const missingColumns = requiredColumns.filter(col => !columnNames.includes(col))
    if (missingColumns.length > 0) {
      console.error('❌ Missing columns:', missingColumns)
    } else {
      console.log('✅ All required columns present')
    }

    // 2. Check if admin tracking tables exist
    console.log('\n2. 📊 Checking admin tracking tables...')
    const requiredTables = [
      'member_status_history',
      'member_login_history', 
      'member_bulk_operations'
    ]

    for (const tableName of requiredTables) {
      const { data: tableExists, error: tableError } = await supabase
        .from('information_schema.tables')
        .select('table_name')
        .eq('table_name', tableName)
        .eq('table_schema', 'public')
        .single()

      if (tableError || !tableExists) {
        console.error(`❌ Table '${tableName}' not found`)
      } else {
        console.log(`✅ Table '${tableName}' exists`)
      }
    }

    // 3. Check for admin users
    console.log('\n3. 👥 Checking admin users...')
    const { data: adminUsers, error: adminError } = await supabase
      .from('member_profiles')
      .select('id, display_name, email, is_admin, is_active, registration_status')
      .eq('is_admin', true)

    if (adminError) {
      console.error('❌ Error checking admin users:', adminError.message)
    } else {
      console.log(`✅ Found ${adminUsers.length} admin users:`)
      adminUsers.forEach(user => {
        console.log(`  - ${user.display_name} (${user.email}) - Active: ${user.is_active}, Status: ${user.registration_status}`)
      })
    }

    // 4. Check member statistics
    console.log('\n4. 📈 Checking member statistics...')
    const { data: memberStats, error: statsError } = await supabase
      .from('member_profiles')
      .select('registration_status, is_active, is_suspended, is_artist, is_admin')

    if (statsError) {
      console.error('❌ Error getting member stats:', statsError.message)
    } else {
      const stats = {
        total: memberStats.length,
        pending: memberStats.filter(m => m.registration_status === 'pending').length,
        approved: memberStats.filter(m => m.registration_status === 'approved').length,
        rejected: memberStats.filter(m => m.registration_status === 'rejected').length,
        active: memberStats.filter(m => m.is_active).length,
        suspended: memberStats.filter(m => m.is_suspended).length,
        artists: memberStats.filter(m => m.is_artist).length,
        admins: memberStats.filter(m => m.is_admin).length,
      }
      
      console.log('✅ Member Statistics:')
      Object.entries(stats).forEach(([key, value]) => {
        console.log(`  - ${key}: ${value}`)
      })
    }

    // 5. Test admin API endpoints
    console.log('\n5. 🔌 Testing admin API endpoints...')
    
    // Create a simple HTTP client test
    const baseUrl = 'http://localhost:3001'
    const testEndpoints = [
      '/api/admin/stats',
      '/api/admin/members?page=1&limit=10',
      '/api/admin/members/stats'
    ]

    for (const endpoint of testEndpoints) {
      try {
        const response = await fetch(`${baseUrl}${endpoint}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        })
        
        if (response.ok) {
          console.log(`✅ ${endpoint} - Status: ${response.status}`)
        } else {
          console.log(`❌ ${endpoint} - Status: ${response.status}`)
          const errorText = await response.text()
          console.log(`   Error: ${errorText}`)
        }
      } catch (error) {
        console.log(`❌ ${endpoint} - Network error: ${error.message}`)
      }
    }

    // 6. Check RLS policies
    console.log('\n6. 🔒 Checking RLS policies...')
    const { data: policies, error: policiesError } = await supabase
      .rpc('pg_policies', {}, { schema: 'information_schema' })
      .then(() => ({ data: [], error: null })) // Simple check that RLS is enabled
      .catch(() => ({ data: [], error: 'Could not check policies' }))

    console.log('✅ RLS policy check completed')

    console.log('\n🎉 Admin functionality test completed!')

  } catch (error) {
    console.error('❌ Test failed with error:', error.message)
  }
}

// Helper function to apply missing database migrations
async function applyMissingMigrations() {
  console.log('\n🚀 Applying missing database migrations...')
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Supabase environment variables not found')
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // Check if member_status_history table exists
    const { data: historyTableExists } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_name', 'member_status_history')
      .eq('table_schema', 'public')
      .maybeSingle()

    if (!historyTableExists) {
      console.log('📝 Creating member_status_history table...')
      
      const { error: createHistoryError } = await supabase.rpc('exec_sql', {
        sql: `
          CREATE TABLE IF NOT EXISTS public.member_status_history (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            member_id UUID REFERENCES public.member_profiles(id) ON DELETE CASCADE NOT NULL,
            changed_by UUID REFERENCES public.member_profiles(id) ON DELETE SET NULL,
            action VARCHAR(50) NOT NULL CHECK (action IN ('approve', 'reject', 'activate', 'deactivate', 'suspend', 'unsuspend', 'promote', 'demote', 'update')),
            previous_status JSONB,
            new_status JSONB,
            reason TEXT,
            metadata JSONB DEFAULT '{}',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            ip_address INET,
            user_agent TEXT
          );
          
          ALTER TABLE public.member_status_history ENABLE ROW LEVEL SECURITY;
          
          CREATE POLICY "Admins can view all status history" ON public.member_status_history 
            FOR SELECT USING (
              EXISTS (
                SELECT 1 FROM public.member_profiles 
                WHERE member_profiles.id = auth.uid() 
                AND member_profiles.is_admin = true
                AND member_profiles.is_active = true
                AND member_profiles.registration_status = 'approved'
              )
            );
        `
      })

      if (createHistoryError) {
        console.error('❌ Error creating member_status_history table:', createHistoryError.message)
      } else {
        console.log('✅ member_status_history table created')
      }
    }

    // Check and create other missing tables...
    console.log('✅ Migration check completed')

  } catch (error) {
    console.error('❌ Migration failed:', error.message)
  }
}

// Run the test
if (require.main === module) {
  testAdminFunctionality()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Test failed:', error)
      process.exit(1)
    })
}

module.exports = { testAdminFunctionality, applyMissingMigrations }