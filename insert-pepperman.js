#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js')

// 후추맨 데이터 (데이터베이스 스키마에 맞춘 형식)
const peppermanData = {
  legacy_id: 'artist-014',
  slug: 'pepperman',
  name: '후추맨',
  category: ['창작자'],
  profile_photo_url: '/images/artists/pepperman.webp',
  one_liner: '심심한걸 못 참는 저주를 받은 게으름뱅이의 뒤늦은 메탈/하드코어 음악생활',
  bio: "후추맨(본명: 유호강)은 2024년 UMD(우만동메탈군단) 결성 이후 왕성한 활동을 펼치고 있는 메탈/하드코어 아티스트입니다.\n\n### 음악적 여정\n\n심심한 걸 못 참는 저주를 받은 게으름뱅이의 뒤늦은 메탈/하드코어 음악생활을 통해 UMD와 함께 서울, 경기 지역의 다양한 클럽 무대에서 활동하고 있습니다. 사바하, 판저코프스, 메리디에스 등 유수의 메탈 밴드들과 협연을 이어가며 한국 메탈 씬에서 주목받는 신예로 자리잡고 있습니다.\n\n### 주요 활동\n\n2024년 UMD 결성 이후 다회의 서울, 경기 클럽 공연에 참여했으며, MMC 아이언맨 스페셜에도 참가했습니다. 또한 수원에서 열린 '철조망: METAL SYNDICATE NETWORK' 1회차에 UMD로 참가하여 경기도 로컬 메탈 씬의 네트워크 구축에 기여했습니다.\n\n현재는 별도의 그라인드코어 밴드를 결성하여 연말 음원 발매를 목표로 준비 중이며, 더욱 다양한 메탈 장르로 음악적 스펙트럼을 넓혀가고 있습니다.\n\n### 음악 장르\n- 메탈\n- 하드코어\n- 그라인드코어",
  template_type: '콜라주형',
  portfolio_links: [
    { title: 'Instagram', url: 'https://www.instagram.com/pepper.sickness' },
    { title: 'UMD Instagram', url: 'https://www.instagram.com/umd.metal' },
  ],
  youtube_videos: [
    { title: 'MMC 아이언맨 스페셜', url: 'https://youtu.be/FbNg7qVOJPw?si=ncdsSyb5SziwswmT' },
  ],
  contact: null,
}

async function insertPepperman() {
  // 환경변수 확인
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Required environment variables not found!')
    console.error('NEXT_PUBLIC_SUPABASE_URL:', !!process.env.NEXT_PUBLIC_SUPABASE_URL)
    console.error('SUPABASE_SERVICE_ROLE_KEY:', !!process.env.SUPABASE_SERVICE_ROLE_KEY)
    process.exit(1)
  }

  // Supabase 클라이언트 생성 (서비스 역할 키 사용)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )

  console.log('Supabase client created successfully')

  try {
    // 먼저 기존 데이터가 있는지 확인 (slug나 legacy_id로)
    const { data: existing, error: checkError } = await supabase
      .from('artists')
      .select('id, name, slug, legacy_id')
      .or('slug.eq.pepperman,legacy_id.eq.artist-014')
      .single()

    if (checkError && checkError.code !== 'PGRST116') {
      throw checkError
    }

    if (existing) {
      console.log('후추맨이 이미 존재합니다:', existing)

      // 기존 데이터 업데이트
      const { data, error } = await supabase
        .from('artists')
        .update(peppermanData)
        .eq('id', existing.id)
        .select()

      if (error) {
        throw error
      }

      console.log('후추맨 데이터가 업데이트되었습니다:', data)
    } else {
      // 새로 삽입
      const { data, error } = await supabase.from('artists').insert([peppermanData]).select()

      if (error) {
        throw error
      }

      console.log('후추맨이 성공적으로 추가되었습니다:', data)
    }

    // 삽입/업데이트 후 확인
    const { data: result, error: verifyError } = await supabase
      .from('artists')
      .select('id, name, slug')
      .eq('slug', 'pepperman')
      .single()

    if (verifyError) {
      throw verifyError
    }

    console.log('최종 확인 - 후추맨 데이터:', result)
  } catch (error) {
    console.error('Error inserting 후추맨:', error)
    process.exit(1)
  }
}

// 스크립트 실행
insertPepperman()
