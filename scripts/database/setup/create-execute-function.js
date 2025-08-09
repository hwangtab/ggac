const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function createExecuteFunction() {
  try {
    console.log('Creating execute_sql function...');
    
    // Create a function that can execute raw SQL
    const { data, error } = await supabase.rpc('exec', {
      query: `
        CREATE OR REPLACE FUNCTION public.execute_sql(sql_query TEXT)
        RETURNS TEXT AS $$
        BEGIN
          EXECUTE sql_query;
          RETURN 'Success';
        EXCEPTION WHEN OTHERS THEN
          RETURN 'Error: ' || SQLERRM;
        END;
        $$ LANGUAGE plpgsql SECURITY DEFINER;
      `
    });

    if (error) {
      console.error('Error creating function:', error);
      
      // Try alternative approach using a different method
      console.log('Trying alternative approach...');
      
      // Maybe we need to use the admin/service key
      console.log('This requires admin privileges to create functions.');
      console.log('Please run the following SQL in your Supabase SQL Editor:');
      console.log('');
      console.log(`
CREATE OR REPLACE FUNCTION public.execute_sql(sql_query TEXT)
RETURNS TEXT AS $$
BEGIN
  EXECUTE sql_query;
  RETURN 'Success';
EXCEPTION WHEN OTHERS THEN
  RETURN 'Error: ' || SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
      `);
      console.log('');
      console.log('Then run the following to add the is_member column:');
      console.log('');
      console.log('SELECT public.execute_sql(\'ALTER TABLE public.member_profiles ADD COLUMN IF NOT EXISTS is_member BOOLEAN DEFAULT false;\');');
      console.log('');
      
      return;
    }

    console.log('Function created successfully');
    
    // Now use the function to add the column
    const { data: result, error: execError } = await supabase.rpc('execute_sql', {
      sql_query: 'ALTER TABLE public.member_profiles ADD COLUMN IF NOT EXISTS is_member BOOLEAN DEFAULT false;'
    });

    if (execError) {
      console.error('Error executing SQL:', execError);
      return;
    }

    console.log('SQL execution result:', result);

  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

// Run the function
createExecuteFunction();