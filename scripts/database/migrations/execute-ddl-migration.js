const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function executeDDLMigration() {
  try {
    console.log('Attempting to execute DDL migration...');
    
    // First, let's create a simple test to verify we can create functions
    console.log('Testing function creation capabilities...');
    
    const { data, error } = await supabase.rpc('handle_new_user');
    
    if (error && error.code === 'PGRST202') {
      console.log('Cannot create custom RPC functions with current permissions.');
      console.log('');
      console.log('MANUAL STEPS REQUIRED:');
      console.log('===================');
      console.log('');
      console.log('1. Open your Supabase Dashboard: https://supabase.com/dashboard/project/btugywkltavbogdnhwpu');
      console.log('2. Go to the SQL Editor');
      console.log('3. Run the following SQL to add the missing is_member column:');
      console.log('');
      console.log('-- Add is_member column to member_profiles table');
      console.log('ALTER TABLE public.member_profiles ADD COLUMN IF NOT EXISTS is_member BOOLEAN DEFAULT false;');
      console.log('');
      console.log('-- Update existing records to set is_member = true for users with complete profile information');
      console.log('UPDATE public.member_profiles SET is_member = true WHERE phone_number IS NOT NULL AND real_name IS NOT NULL;');
      console.log('');
      console.log('-- Create index on is_member column for better query performance');
      console.log('CREATE INDEX IF NOT EXISTS idx_member_profiles_is_member ON public.member_profiles(is_member);');
      console.log('');
      console.log('-- Add comment to document the column purpose');
      console.log('COMMENT ON COLUMN public.member_profiles.is_member IS \'Indicates if the user is an active member of the cooperative\';');
      console.log('');
      console.log('4. After running the SQL, run this script again to verify the changes:');
      console.log('   node add-is-member-column.js');
      console.log('');
      
      return;
    }

    console.log('Function test result:', data, error);

  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

// Run the function
executeDDLMigration();