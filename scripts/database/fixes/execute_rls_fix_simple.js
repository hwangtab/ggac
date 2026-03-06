const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing required environment variables')
  process.exit(1)
}

// Create Supabase client
const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function executeRLSFixes() {
  console.log('Starting RLS policy fix...')

  // Array of SQL statements to execute
  const statements = [
    // Drop existing policies
    'DROP POLICY IF EXISTS "Users can view own profile" ON public.member_profiles',
    'DROP POLICY IF EXISTS "Users can update own profile" ON public.member_profiles',
    'DROP POLICY IF EXISTS "Users can insert own profile" ON public.member_profiles',
    'DROP POLICY IF EXISTS "Users can create own profile" ON public.member_profiles',
    'DROP POLICY IF EXISTS "Authenticated users can view profiles" ON public.member_profiles',
    'DROP POLICY IF EXISTS "Admins can view all profiles" ON public.member_profiles',
    'DROP POLICY IF EXISTS "Admins can update all profiles" ON public.member_profiles',
    'DROP POLICY IF EXISTS "Service role can access all profiles" ON public.member_profiles',

    // Create safe admin check function
    `CREATE OR REPLACE FUNCTION public.is_admin_user(user_id UUID)
     RETURNS boolean
     SECURITY DEFINER
     SET search_path = public
     AS $$
     BEGIN
       RETURN EXISTS (
         SELECT 1 FROM public.member_profiles 
         WHERE id = user_id 
         AND is_admin = true 
         AND is_active = true
       );
     END;
     $$ LANGUAGE plpgsql`,

    // Create new policies
    `CREATE POLICY "Users can view own profile" ON public.member_profiles
     FOR SELECT TO authenticated
     USING (auth.uid() = id)`,

    `CREATE POLICY "Users can insert own profile" ON public.member_profiles
     FOR INSERT TO authenticated
     WITH CHECK (auth.uid() = id)`,

    `CREATE POLICY "Users can update own profile" ON public.member_profiles
     FOR UPDATE TO authenticated
     USING (auth.uid() = id)
     WITH CHECK (auth.uid() = id)`,

    `CREATE POLICY "Service role can access all profiles" ON public.member_profiles
     FOR ALL TO service_role
     USING (true)
     WITH CHECK (true)`,

    // Enable RLS
    'ALTER TABLE public.member_profiles ENABLE ROW LEVEL SECURITY',
  ]

  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i]
    console.log(`\nExecuting statement ${i + 1}/${statements.length}:`)
    console.log(statement.substring(0, 100) + (statement.length > 100 ? '...' : ''))

    try {
      const { data, error } = await supabase.rpc('exec_sql', {
        sql_query: statement,
      })

      if (error) {
        console.error('Error:', error)
        // Try alternative approach
        const { data: altData, error: altError } = await supabase
          .from('pg_stat_activity')
          .select('*')
          .limit(1)

        if (altError) {
          console.error('Alternative connection also failed:', altError)
        }
      } else {
        console.log('✓ Statement executed successfully')
      }
    } catch (err) {
      console.error('Exception:', err)
    }
  }

  console.log('\nRLS policy fix completed.')
}

// Check user profile
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

// Execute
executeRLSFixes()
  .then(() => checkUserProfile())
  .catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
