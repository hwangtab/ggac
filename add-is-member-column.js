const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function addIsMemberColumn() {
  try {
    console.log('Checking current table structure...');
    
    // First, let's try to read from the table to see what columns exist
    const { data: sampleData, error: sampleError } = await supabase
      .from('member_profiles')
      .select('*')
      .limit(1);

    if (sampleError) {
      console.error('Error reading from member_profiles table:', sampleError);
      return;
    }

    console.log('Current table structure (showing one row to see columns):');
    if (sampleData && sampleData.length > 0) {
      console.log('Columns found:', Object.keys(sampleData[0]));
      
      // Check if is_member column exists
      const hasMemberColumn = Object.keys(sampleData[0]).includes('is_member');
      
      if (hasMemberColumn) {
        console.log('✅ is_member column already exists');
        
        // Show sample data
        console.log('Sample data from member_profiles:');
        const { data: allData, error: allError } = await supabase
          .from('member_profiles')
          .select('id, display_name, is_member, phone_number, real_name, registration_status')
          .limit(5);
        
        if (allError) {
          console.error('Error fetching sample data:', allError);
          return;
        }
        
        console.table(allData);
      } else {
        console.log('❌ is_member column does not exist');
        console.log('');
        console.log('Please run the following SQL in your Supabase SQL Editor:');
        console.log('');
        console.log('ALTER TABLE public.member_profiles ADD COLUMN IF NOT EXISTS is_member BOOLEAN DEFAULT false;');
        console.log('');
        console.log('UPDATE public.member_profiles SET is_member = true WHERE phone_number IS NOT NULL AND real_name IS NOT NULL;');
        console.log('');
      }
    } else {
      console.log('No data found in member_profiles table');
      
      // Try to select is_member specifically to see if column exists
      const { data: testData, error: testError } = await supabase
        .from('member_profiles')
        .select('is_member')
        .limit(1);
      
      if (testError) {
        if (testError.code === 'PGRST116' || testError.message.includes('column "is_member" does not exist')) {
          console.log('❌ is_member column does not exist');
          console.log('');
          console.log('Please run the following SQL in your Supabase SQL Editor:');
          console.log('');
          console.log('ALTER TABLE public.member_profiles ADD COLUMN IF NOT EXISTS is_member BOOLEAN DEFAULT false;');
          console.log('');
        } else {
          console.error('Error testing is_member column:', testError);
        }
      } else {
        console.log('✅ is_member column exists (table is empty)');
      }
    }

  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

// Run the function
addIsMemberColumn();