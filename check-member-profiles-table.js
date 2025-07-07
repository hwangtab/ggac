const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log('Supabase URL:', supabaseUrl);
console.log('Supabase Key:', supabaseKey ? 'Set' : 'Not Set');
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkMemberProfilesTable() {
    console.log('=== Member Profiles Table Structure Check ===\n');
    
    try {
        // 1. 테이블 존재 여부 확인 - 직접 테이블에 접근해서 확인
        console.log('1. Checking if member_profiles table exists...');
        const { data: testData, error: testError } = await supabase
            .from('member_profiles')
            .select('*')
            .limit(1);
        
        if (testError) {
            console.error('❌ member_profiles table does not exist or is not accessible:', testError);
            return;
        }
        
        console.log('✅ member_profiles table exists and is accessible');
        
        // 2. 테이블 구조 확인을 위해 RPC 함수 사용
        console.log('\n2. Checking table columns using RPC...');
        const { data: rpcData, error: rpcError } = await supabase
            .rpc('get_table_columns', { table_name: 'member_profiles' });
        
        if (rpcError) {
            console.log('RPC function not available, using direct query method...');
            
            // 3. 직접 쿼리로 테이블 구조 확인
            console.log('\n3. Checking table structure through direct query...');
            const { data: sampleData, error: sampleError } = await supabase
                .from('member_profiles')
                .select('*')
                .limit(1);
            
            if (sampleError) {
                console.error('Error fetching sample data:', sampleError);
                return;
            }
            
            if (sampleData.length > 0) {
                console.log('Available columns based on sample data:');
                const columns = Object.keys(sampleData[0]);
                columns.forEach(col => {
                    console.log(`  - ${col}`);
                });
                
                // 4. 필요한 컬럼들이 존재하는지 확인
                console.log('\n4. Checking required columns...');
                const requiredColumns = [
                    'phone_number',
                    'birth_date', 
                    'real_name',
                    'monthly_fee',
                    'bank_name',
                    'account_number',
                    'account_holder'
                ];
                
                const existingColumns = columns;
                const missingColumns = requiredColumns.filter(col => !existingColumns.includes(col));
                
                if (missingColumns.length > 0) {
                    console.log('❌ Missing columns:', missingColumns);
                    console.log('\nYou need to run the add_member_info_columns.sql script to add these columns.');
                } else {
                    console.log('✅ All required columns exist');
                }
                
                console.log('\n5. Sample data structure:');
                console.log(JSON.stringify(sampleData[0], null, 2));
            } else {
                console.log('No data in table, checking structure by attempting selective queries...');
                
                // 5. 각 컬럼을 개별적으로 테스트해서 존재 여부 확인
                console.log('\n5. Testing individual columns...');
                const requiredColumns = [
                    'id',
                    'email',
                    'display_name',
                    'is_member',
                    'phone_number',
                    'birth_date', 
                    'real_name',
                    'monthly_fee',
                    'bank_name',
                    'account_number',
                    'account_holder',
                    'created_at',
                    'updated_at'
                ];
                
                const existingColumns = [];
                const missingColumns = [];
                
                for (const column of requiredColumns) {
                    try {
                        const { data, error } = await supabase
                            .from('member_profiles')
                            .select(column)
                            .limit(1);
                        
                        if (error) {
                            if (error.code === '42703') { // Column does not exist
                                missingColumns.push(column);
                                console.log(`  ❌ ${column} - does not exist`);
                            } else {
                                console.log(`  ⚠️ ${column} - exists but other error: ${error.message}`);
                                existingColumns.push(column);
                            }
                        } else {
                            existingColumns.push(column);
                            console.log(`  ✅ ${column} - exists`);
                        }
                    } catch (err) {
                        console.log(`  ❓ ${column} - error testing: ${err.message}`);
                    }
                }
                
                console.log('\n6. Summary:');
                console.log(`Existing columns: ${existingColumns.join(', ')}`);
                if (missingColumns.length > 0) {
                    console.log(`Missing columns: ${missingColumns.join(', ')}`);
                    console.log('\n⚠️ You need to run the add_member_info_columns.sql script to add the missing columns.');
                } else {
                    console.log('✅ All required columns exist');
                }
            }
        } else {
            console.log('Table columns from RPC:', rpcData);
        }
        
        // 6. 현재 데이터 카운트 확인
        console.log('\n6. Checking current data count...');
        const { count, error: countError } = await supabase
            .from('member_profiles')
            .select('*', { count: 'exact', head: true });
        
        if (countError) {
            console.error('Error counting profiles:', countError);
        } else {
            console.log(`Total profiles in table: ${count}`);
        }
        
    } catch (error) {
        console.error('Unexpected error:', error);
    }
}

// Run the check
checkMemberProfilesTable().then(() => {
    console.log('\n=== Check completed ===');
    process.exit(0);
}).catch(error => {
    console.error('Script error:', error);
    process.exit(1);
});