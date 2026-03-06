const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

// Read environment variables
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables:')
  console.error('NEXT_PUBLIC_SUPABASE_URL:', !!supabaseUrl)
  console.error('SUPABASE_SERVICE_ROLE_KEY:', !!supabaseServiceKey)
  process.exit(1)
}

// Create Supabase client with service role key
const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Read the SQL file
const sqlFile = path.join(__dirname, 'fix_rls_policies_immediate.sql')
const sqlContent = fs.readFileSync(sqlFile, 'utf8')

// Split SQL into individual statements
const statements = sqlContent
  .split(';')
  .map(stmt => stmt.trim())
  .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'))

async function executeSQLStatements() {
  console.log('Starting RLS policy fix...')

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i]
    console.log(`\nExecuting statement ${i + 1}/${statements.length}:`)
    console.log(statement.substring(0, 100) + (statement.length > 100 ? '...' : ''))

    try {
      const { data, error } = await supabase.rpc('exec_sql', {
        sql: statement + ';',
      })

      if (error) {
        console.error('Error executing statement:', error)
        // Continue with next statement for non-critical errors
      } else {
        console.log('✓ Statement executed successfully')
      }
    } catch (err) {
      console.error('Exception executing statement:', err)
      // Continue with next statement
    }
  }

  console.log('\nRLS policy fix completed.')
}

// Also check user profile after
async function checkUserProfile() {
  const userId = 'ab6617b4-532c-4820-8a75-553139868b2a'

  console.log('\n=== Checking user profile ===')

  try {
    const { data, error } = await supabase.from('member_profiles').select('*').eq('id', userId)

    if (error) {
      console.error('Error fetching user profile:', error)
    } else {
      console.log('User profile data:', data)
    }
  } catch (err) {
    console.error('Exception checking user profile:', err)
  }
}

// Execute the fixes
executeSQLStatements()
  .then(() => checkUserProfile())
  .catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
