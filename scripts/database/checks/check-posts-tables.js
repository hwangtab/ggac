/**
 * Posts Tables Status Checker
 * Specifically checks post_attachments and post_likes tables
 */

const { createClient } = require('@supabase/supabase-js')

async function checkPostsTables() {
  console.log('🔍 Checking Posts-related Tables...\\n')

  // Load environment variables from .env.local
  const fs = require('fs')
  const path = require('path')

  try {
    const envPath = path.join(__dirname, '.env.local')
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf8')
      const lines = envContent.split('\\n')

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed && !trimmed.startsWith('#')) {
          const [key, value] = trimmed.split('=')
          if (key && value) {
            process.env[key] = value
          }
        }
      }
      console.log('✅ Loaded environment variables from .env.local')
    }
  } catch (error) {
    console.log('⚠️ Could not load .env.local:', error.message)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('❌ Supabase environment variables not found')
    return
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey)

  try {
    console.log('1. 📊 Checking posts table structure...')

    // Check posts table columns
    const { data: posts, error: postsError } = await supabase
      .from('posts')
      .select('id, like_count')
      .limit(1)

    if (postsError) {
      console.log(`❌ Cannot access posts table: ${postsError.message}`)
    } else {
      console.log('✅ Posts table accessible')
      if (posts && posts.length > 0 && 'like_count' in posts[0]) {
        console.log('✅ like_count column exists in posts')
      } else {
        console.log('❌ like_count column missing in posts')
      }
    }

    console.log('\\n2. 📋 Checking post_attachments table...')

    const { data: attachments, error: attachmentsError } = await supabase
      .from('post_attachments')
      .select('id')
      .limit(1)

    if (attachmentsError) {
      if (attachmentsError.message.includes('does not exist')) {
        console.log('❌ post_attachments table does not exist')
      } else {
        console.log(
          `⚠️ post_attachments table exists but has access issues: ${attachmentsError.message}`
        )
      }
    } else {
      console.log('✅ post_attachments table exists and accessible')
    }

    console.log('\\n3. 📋 Checking post_likes table...')

    const { data: likes, error: likesError } = await supabase
      .from('post_likes')
      .select('id')
      .limit(1)

    if (likesError) {
      if (likesError.message.includes('does not exist')) {
        console.log('❌ post_likes table does not exist')
      } else {
        console.log(`⚠️ post_likes table exists but has access issues: ${likesError.message}`)
      }
    } else {
      console.log('✅ post_likes table exists and accessible')
    }

    console.log('\\n4. 👑 Checking admin users status...')

    const { data: adminUsers, error: adminError } = await supabase
      .from('member_profiles')
      .select('display_name, email, is_admin, is_active, registration_status')
      .eq('is_admin', true)

    if (adminError) {
      console.log(`⚠️ Cannot check admin users: ${adminError.message}`)
    } else if (adminUsers && adminUsers.length > 0) {
      console.log(`✅ Found ${adminUsers.length} admin user(s):`)
      adminUsers.forEach(user => {
        const status =
          user.is_active && user.registration_status === 'approved' ? '✅ Active' : '⚠️ Inactive'
        console.log(`   ${status} ${user.display_name} (${user.email})`)
      })
    } else {
      console.log('❌ No admin users found')
    }

    console.log('\\n📋 Summary:')
    console.log('This shows the exact status of posts-related tables that the admin API needs.')
  } catch (error) {
    console.error('❌ Check failed:', error.message)
  }
}

if (require.main === module) {
  checkPostsTables()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Check failed:', error)
      process.exit(1)
    })
}

module.exports = { checkPostsTables }
