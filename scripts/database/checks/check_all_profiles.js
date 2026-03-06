const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing required environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function checkAllProfiles() {
  console.log('=== Checking all profiles ===')

  try {
    // Try to fetch all profiles
    const { data, error } = await supabase.from('member_profiles').select('*')

    if (error) {
      console.error('❌ Error fetching profiles:', error)
    } else {
      console.log('✅ Total profiles found:', data.length)

      if (data.length > 0) {
        console.log('\n📊 Profile details:')
        data.forEach((profile, index) => {
          console.log(`  ${index + 1}. ${profile.display_name} (${profile.email})`)
          console.log(`     ID: ${profile.id}`)
          console.log(`     Status: ${profile.registration_status}`)
          console.log(`     Active: ${profile.is_active}`)
          console.log(`     Admin: ${profile.is_admin}`)
          console.log(`     Created: ${profile.created_at}`)
          console.log('     ---')
        })
      } else {
        console.log('⚠️  No profiles found in the database')
      }
    }
  } catch (err) {
    console.error('❌ Exception checking profiles:', err)
  }

  // Also check auth users if possible
  console.log('\n=== Checking auth users ===')
  try {
    // This might not work with anon key, but let's try
    const { data: authData, error: authError } = await supabase.auth.admin.listUsers()

    if (authError) {
      console.error('❌ Cannot access auth users (expected with anon key):', authError.message)
    } else {
      console.log('✅ Auth users found:', authData.users.length)
    }
  } catch (err) {
    console.error('❌ Cannot access auth users (expected with anon key):', err.message)
  }
}

// Execute the check
checkAllProfiles().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
