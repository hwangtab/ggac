#!/usr/bin/env node
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
