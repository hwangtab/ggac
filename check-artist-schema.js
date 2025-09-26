#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js')

async function checkArtistSchema() {
  // 환경변수 확인
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Required environment variables not found!')
    process.exit(1)
  }

  // Supabase 클라이언트 생성 (서비스 역할 키 사용)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  try {
    // 기존 아티스트 몇 개 가져와서 구조 확인
    const { data: artists, error } = await supabase.from('artists').select('*').limit(3)

    if (error) {
      throw error
    }

    console.log('기존 아티스트 구조:')
    artists.forEach((artist, index) => {
      console.log(`\n${index + 1}. 아티스트:`)
      console.log('ID:', artist.id, '(type:', typeof artist.id, ')')
      console.log('Name:', artist.name)
      console.log('Slug:', artist.slug)
      console.log('모든 필드들:', Object.keys(artist))
    })
  } catch (error) {
    console.error('Error checking schema:', error)
    process.exit(1)
  }
}

// 스크립트 실행
checkArtistSchema()
