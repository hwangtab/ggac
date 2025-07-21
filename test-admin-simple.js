/**
 * Simple Admin API Test Script
 * Tests admin endpoints through HTTP requests
 */

async function testAdminAPIs() {
  console.log('🔍 Testing Admin API Endpoints...\n')

  const baseUrl = 'http://localhost:3000'
  
  // Test endpoints without authentication first
  const endpoints = [
    { path: '/api/admin/stats', requiresAuth: true },
    { path: '/api/admin/members', requiresAuth: true },
    { path: '/api/admin/members/stats', requiresAuth: true }
  ]

  console.log('📡 Testing API endpoints...')
  
  for (const endpoint of endpoints) {
    try {
      console.log(`\nTesting: ${endpoint.path}`)
      
      const response = await fetch(`${baseUrl}${endpoint.path}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      console.log(`  Status: ${response.status}`)
      
      if (response.ok) {
        const data = await response.json()
        console.log(`  ✅ Success:`, JSON.stringify(data, null, 2))
      } else {
        const errorText = await response.text()
        console.log(`  ❌ Error: ${errorText}`)
        
        // Try to parse as JSON for better error messages
        try {
          const errorJson = JSON.parse(errorText)
          console.log(`  📝 Error details:`, errorJson)
        } catch (e) {
          // Text response, already logged above
        }
      }
    } catch (error) {
      console.log(`  ❌ Network error: ${error.message}`)
    }
  }

  console.log('\n🎯 Testing specific scenarios...')
  
  // Test CORS and options requests
  try {
    const corsResponse = await fetch(`${baseUrl}/api/admin/stats`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:3000',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Content-Type, Authorization'
      }
    })
    
    console.log(`\nCORS OPTIONS request: ${corsResponse.status}`)
    console.log('CORS headers:', Object.fromEntries(corsResponse.headers.entries()))
  } catch (error) {
    console.log('CORS test failed:', error.message)
  }

  console.log('\n🏁 Admin API test completed!')
}

// Simple function to check if the dev server is running
async function checkServerStatus() {
  try {
    const response = await fetch('http://localhost:3000/')
    console.log(`✅ Development server is running (Status: ${response.status})`)
    return true
  } catch (error) {
    console.log('❌ Development server is not running:', error.message)
    console.log('💡 Please run: npm run dev')
    return false
  }
}

// Check admin page accessibility
async function checkAdminPageAccess() {
  console.log('\n🔐 Testing admin page access...')
  
  try {
    const response = await fetch('http://localhost:3000/admin')
    console.log(`Admin page status: ${response.status}`)
    
    if (response.ok) {
      const html = await response.text()
      if (html.includes('관리자 대시보드') || html.includes('Admin Dashboard')) {
        console.log('✅ Admin page loads successfully')
      } else {
        console.log('⚠️ Admin page loads but content may be missing')
      }
    } else {
      console.log('❌ Admin page access failed')
    }
  } catch (error) {
    console.log('❌ Cannot access admin page:', error.message)
  }
}

// Main test function
async function main() {
  console.log('🚀 Starting Admin Functionality Tests\n')
  
  // Check if server is running first
  const serverRunning = await checkServerStatus()
  if (!serverRunning) {
    return
  }

  // Check admin page access
  await checkAdminPageAccess()
  
  // Test admin APIs
  await testAdminAPIs()

  console.log('\n📋 Summary:')
  console.log('- If you see 401 errors, the APIs are working but need authentication')
  console.log('- If you see 403 errors, authentication works but user lacks admin privileges') 
  console.log('- If you see 500 errors, there may be database schema issues')
  console.log('- If you see network errors, the server may not be running')
}

if (require.main === module) {
  main().catch(console.error)
}

module.exports = { testAdminAPIs, checkServerStatus, checkAdminPageAccess }