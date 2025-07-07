const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkUserProfile() {
  const userId = 'ab6617b4-532c-4820-8a75-553139868b2a';
  
  console.log('=== Checking user profile ===');
  console.log('User ID:', userId);
  
  try {
    // Try to fetch the user profile
    const { data, error } = await supabase
      .from('member_profiles')
      .select('*')
      .eq('id', userId);
    
    if (error) {
      console.error('❌ Error fetching user profile:', error);
      
      // Check if the error is related to RLS
      if (error.code === 'PGRST001' || error.message.includes('RLS')) {
        console.log('🔍 This appears to be an RLS-related issue');
      }
    } else {
      console.log('✅ User profile data:', data);
      
      if (data.length === 0) {
        console.log('⚠️  No profile found for this user ID');
      } else {
        console.log('📊 Profile found:');
        console.log('  - Display Name:', data[0].display_name);
        console.log('  - Email:', data[0].email);
        console.log('  - Registration Status:', data[0].registration_status);
        console.log('  - Is Active:', data[0].is_active);
        console.log('  - Is Admin:', data[0].is_admin);
        console.log('  - Created At:', data[0].created_at);
      }
    }
  } catch (err) {
    console.error('❌ Exception checking user profile:', err);
  }
  
  // Also try to check the table structure
  console.log('\n=== Checking table structure ===');
  try {
    const { data: tableData, error: tableError } = await supabase
      .from('member_profiles')
      .select('*')
      .limit(1);
    
    if (tableError) {
      console.error('❌ Error checking table structure:', tableError);
    } else {
      console.log('✅ Table structure check successful');
      console.log('   Sample data length:', tableData.length);
    }
  } catch (err) {
    console.error('❌ Exception checking table structure:', err);
  }
}

// Execute the check
checkUserProfile()
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });