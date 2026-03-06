const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function verifyAndAddIsMemberColumn() {
  console.log('='.repeat(60))
  console.log('SUPABASE MEMBER_PROFILES TABLE VERIFICATION')
  console.log('='.repeat(60))
  console.log('')

  try {
    console.log('1. Checking if is_member column exists...')

    // Test if the column exists by trying to select it
    const { data: testData, error: testError } = await supabase
      .from('member_profiles')
      .select('is_member')
      .limit(1)

    if (testError) {
      if (testError.code === '42703' || testError.message.includes('does not exist')) {
        console.log('❌ is_member column does NOT exist')
        console.log('')
        console.log('REQUIRED ACTION:')
        console.log('---------------')
        console.log('Please manually add the is_member column by following these steps:')
        console.log('')
        console.log(
          '1. Open Supabase Dashboard: https://supabase.com/dashboard/project/btugywkltavbogdnhwpu'
        )
        console.log('2. Navigate to SQL Editor')
        console.log('3. Copy and paste the following SQL:')
        console.log('')
        console.log('-- Add is_member column to member_profiles table')
        console.log(
          'ALTER TABLE public.member_profiles ADD COLUMN IF NOT EXISTS is_member BOOLEAN DEFAULT false;'
        )
        console.log('')
        console.log(
          '-- Update existing records (set is_member = true for users with complete info)'
        )
        console.log(
          'UPDATE public.member_profiles SET is_member = true WHERE phone_number IS NOT NULL AND real_name IS NOT NULL;'
        )
        console.log('')
        console.log('-- Create index for better performance')
        console.log(
          'CREATE INDEX IF NOT EXISTS idx_member_profiles_is_member ON public.member_profiles(is_member);'
        )
        console.log('')
        console.log('-- Add documentation comment')
        console.log(
          "COMMENT ON COLUMN public.member_profiles.is_member IS 'Indicates if the user is an active member of the cooperative';"
        )
        console.log('')
        console.log('4. Execute the SQL')
        console.log('5. Run this script again to verify: node verify-and-add-is-member-column.js')
        console.log('')

        return false
      } else {
        console.error('❌ Unexpected error testing is_member column:', testError)
        return false
      }
    }

    console.log('✅ is_member column exists!')
    console.log('')

    // Get current table structure
    console.log('2. Checking current table structure...')
    const { data: sampleData, error: sampleError } = await supabase
      .from('member_profiles')
      .select('*')
      .limit(1)

    if (sampleError) {
      console.error('❌ Error fetching sample data:', sampleError)
      return false
    }

    if (sampleData && sampleData.length > 0) {
      console.log('✅ Table columns:', Object.keys(sampleData[0]).join(', '))
    } else {
      console.log('✅ Table exists but is empty')
    }
    console.log('')

    // Check existing data
    console.log('3. Checking existing data...')
    const { data: allData, error: allError } = await supabase
      .from('member_profiles')
      .select(
        'id, display_name, email, is_member, phone_number, real_name, registration_status, is_active'
      )
      .limit(10)

    if (allError) {
      console.error('❌ Error fetching data:', allError)
      return false
    }

    if (allData && allData.length > 0) {
      console.log(`✅ Found ${allData.length} records in member_profiles table:`)
      console.table(allData)

      // Analyze is_member distribution
      const memberCount = allData.filter(row => row.is_member).length
      const nonMemberCount = allData.filter(row => !row.is_member).length

      console.log('')
      console.log('📊 is_member status distribution:')
      console.log(`   - Members (is_member = true): ${memberCount}`)
      console.log(`   - Non-members (is_member = false): ${nonMemberCount}`)
      console.log(`   - Total records: ${allData.length}`)
    } else {
      console.log('✅ Table is empty (no records found)')
    }

    console.log('')
    console.log('4. Verification complete!')
    console.log('✅ The is_member column has been successfully added to the member_profiles table.')
    console.log('')

    return true
  } catch (error) {
    console.error('❌ Unexpected error during verification:', error)
    return false
  }
}

// Run the verification
verifyAndAddIsMemberColumn()
  .then(success => {
    if (success) {
      console.log('🎉 SUCCESS: is_member column is properly configured!')
      process.exit(0)
    } else {
      console.log('⚠️  MANUAL ACTION REQUIRED: Please follow the instructions above.')
      process.exit(1)
    }
  })
  .catch(error => {
    console.error('Script execution failed:', error)
    process.exit(1)
  })
