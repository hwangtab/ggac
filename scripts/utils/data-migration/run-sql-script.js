const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Note: This requires service role key for DDL operations
// For now, we'll try with the anon key to see what happens
const supabase = createClient(supabaseUrl, supabaseKey)

async function runSQLScript(filePath) {
  try {
    console.log(`Reading SQL script from: ${filePath}`)
    const sqlScript = fs.readFileSync(filePath, 'utf8')
    console.log('SQL Script content:')
    console.log(sqlScript)
    console.log('\n=====================================\n')

    // Split by semicolon and execute each statement
    const statements = sqlScript
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'))

    console.log(`Found ${statements.length} SQL statements to execute`)

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i]
      console.log(`\nExecuting statement ${i + 1}:`)
      console.log(statement)

      try {
        const { data, error } = await supabase.rpc('execute_sql', {
          sql_query: statement,
        })

        if (error) {
          console.error(`❌ Error executing statement ${i + 1}:`, error)
          // Continue with next statement
        } else {
          console.log(`✅ Statement ${i + 1} executed successfully`)
          if (data) {
            console.log('Result:', data)
          }
        }
      } catch (err) {
        console.error(`❌ Exception executing statement ${i + 1}:`, err.message)
      }
    }

    console.log('\n=====================================')
    console.log('SQL script execution completed')
  } catch (error) {
    console.error('Error running SQL script:', error)
  }
}

// Get file path from command line argument
const filePath = process.argv[2]
if (!filePath) {
  console.error('Usage: node run-sql-script.js <path-to-sql-file>')
  process.exit(1)
}

runSQLScript(filePath)
  .then(() => {
    console.log('Script execution finished')
    process.exit(0)
  })
  .catch(error => {
    console.error('Script execution failed:', error)
    process.exit(1)
  })
