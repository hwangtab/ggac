const { performance } = require('perf_hooks')

async function testAPIPerformance() {
  const baseUrl = 'http://localhost:3000'

  console.log('🚀 API 성능 테스트 시작...\n')

  try {
    // 1. 게시글 목록 API 성능 테스트
    console.log('📋 게시글 목록 API 테스트...')
    const start = performance.now()

    const response = await fetch(`${baseUrl}/api/posts?page=1&limit=10`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    const responseTime = performance.now() - start

    if (!response.ok) {
      throw new Error(`API 호출 실패: ${response.status}`)
    }

    const data = await response.json()

    console.log(`✅ API 응답 시간: ${responseTime.toFixed(2)}ms`)
    console.log(`📊 조회된 게시글 수: ${data.data?.posts?.length || 0}`)
    console.log(`📈 총 게시글 수: ${data.data?.total || 0}`)
    console.log(`📄 현재 페이지: ${data.data?.currentPage || 1}`)
    console.log(`📑 총 페이지 수: ${data.data?.totalPages || 1}`)

    // 응답 데이터 검증
    if (data.data?.posts?.length > 0) {
      const samplePost = data.data.posts[0]
      console.log('\n📝 샘플 게시글 데이터 구조:')
      console.log(`   제목: ${samplePost.title || 'N/A'}`)
      console.log(`   작성자: ${samplePost.author_name || 'N/A'}`)
      console.log(`   댓글 수: ${samplePost.comment_count ?? 'N/A'}`)
      console.log(`   좋아요 수: ${samplePost.like_count ?? 'N/A'}`)
      console.log(
        `   좋아요 상태: ${samplePost.is_liked !== undefined ? (samplePost.is_liked ? '❤️' : '🤍') : 'N/A'}`
      )
    }

    // 2. 여러 페이지 성능 테스트
    console.log('\n📚 다중 페이지 성능 테스트...')
    const pageTests = []

    for (let page = 1; page <= 3; page++) {
      const pageStart = performance.now()
      const pageResponse = await fetch(`${baseUrl}/api/posts?page=${page}&limit=5`)
      const pageTime = performance.now() - pageStart

      if (pageResponse.ok) {
        const pageData = await pageResponse.json()
        pageTests.push({
          page,
          time: pageTime,
          posts: pageData.data?.posts?.length || 0,
        })
      }
    }

    console.log('\n📊 페이지별 성능 결과:')
    pageTests.forEach(test => {
      console.log(`   페이지 ${test.page}: ${test.time.toFixed(2)}ms (${test.posts}개 게시글)`)
    })

    const avgTime = pageTests.reduce((sum, test) => sum + test.time, 0) / pageTests.length
    console.log(`   평균 응답 시간: ${avgTime.toFixed(2)}ms`)

    // 3. 성능 기준 검증
    console.log('\n🎯 성능 기준 검증:')
    const TARGET_TIME = 500 // 500ms 목표

    if (responseTime <= TARGET_TIME) {
      console.log(
        `✅ 첫 페이지 로딩: ${responseTime.toFixed(2)}ms (목표: ${TARGET_TIME}ms 이하) - 통과!`
      )
    } else {
      console.log(
        `❌ 첫 페이지 로딩: ${responseTime.toFixed(2)}ms (목표: ${TARGET_TIME}ms 이하) - 개선 필요`
      )
    }

    if (avgTime <= TARGET_TIME) {
      console.log(
        `✅ 평균 응답 시간: ${avgTime.toFixed(2)}ms (목표: ${TARGET_TIME}ms 이하) - 통과!`
      )
    } else {
      console.log(
        `❌ 평균 응답 시간: ${avgTime.toFixed(2)}ms (목표: ${TARGET_TIME}ms 이하) - 개선 필요`
      )
    }

    console.log('\n🎉 API 성능 테스트 완료!')
  } catch (error) {
    console.error('❌ 테스트 실패:', error.message)
  }
}

// 메인 실행
testAPIPerformance()
