const fetch = require('node-fetch');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

async function executeSQLDirectly() {
  console.log('Attempting to execute SQL directly via REST API...');
  
  const sql = `
    ALTER TABLE public.member_profiles ADD COLUMN IF NOT EXISTS is_member BOOLEAN DEFAULT false;
    UPDATE public.member_profiles SET is_member = true WHERE phone_number IS NOT NULL AND real_name IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_member_profiles_is_member ON public.member_profiles(is_member);
    COMMENT ON COLUMN public.member_profiles.is_member IS 'Indicates if the user is an active member of the cooperative';
  `;
  
  try {
    // Try to execute via direct REST API call
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/execute_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      },
      body: JSON.stringify({
        sql_query: sql
      })
    });
    
    const result = await response.text();
    
    if (response.ok) {
      console.log('✅ SQL executed successfully:', result);
      return true;
    } else {
      console.log('❌ Direct API execution failed:', result);
      console.log('Response status:', response.status);
      
      // Show the final instructions
      console.log('');
      console.log('FINAL INSTRUCTIONS:');
      console.log('==================');
      console.log('');
      console.log('Since automated execution is not possible with the current permissions,');
      console.log('please manually execute the SQL in the Supabase Dashboard:');
      console.log('');
      console.log('1. Go to: https://supabase.com/dashboard/project/btugywkltavbogdnhwpu/sql/new');
      console.log('2. Paste and run this SQL:');
      console.log('');
      console.log(sql);
      console.log('');
      console.log('3. Verify with: node verify-and-add-is-member-column.js');
      
      return false;
    }
    
  } catch (error) {
    console.error('❌ Network error:', error.message);
    return false;
  }
}

// Execute the function
executeSQLDirectly().then(success => {
  if (success) {
    console.log('🎉 Column added successfully!');
    process.exit(0);
  } else {
    console.log('⚠️  Manual execution required.');
    process.exit(1);
  }
});