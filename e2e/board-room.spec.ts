import { test, expect } from '@playwright/test'

test.describe('이사회(board-room) 접근 제어', () => {
  // localePrefix 'as-needed' + defaultLocale 'ko' 환경에서 prefix 없는 경로는
  // Accept-Language 로 로케일을 협상한다. 결정적 렌더링을 위해 ko-KR 고정.
  test.use({ locale: 'ko-KR' })

  // 미들웨어(src/middleware/auth.ts)가 /board-room/* 를 보호 경로로 분류하고,
  // 인증되지 않은 사용자를 /login 으로 리다이렉트하는지 검증한다.
  // 이 검증은 인증 세션이 필요 없어 운영 DB 연결과 무관하게 결정적으로 통과한다.
  const guardedPaths = ['/board-room', '/board-room/meetings', '/board-room/documents']

  for (const path of guardedPaths) {
    test(`비로그인 사용자는 ${path} 접근 시 로그인으로 리다이렉트된다`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL(/\/login/, { timeout: 15000 })
    })
  }

  test('비로그인 사용자는 회의 생성 페이지 접근 시 로그인으로 리다이렉트된다', async ({ page }) => {
    await page.goto('/board-room/meetings/new', { waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/login/, { timeout: 15000 })
  })

  // ---------------------------------------------------------------------------
  // 역할별(일반 회원 / 이사 / 관리자) CRUD·투표·정족수 플로우는 인증된 세션
  // 픽스처가 필요하다. 이 저장소에는 아직 로그인 storageState 픽스처가 없고
  // (운영 Supabase에 연결되며 테스트 계정 시드도 없음), CI에서 임의 계정을
  // 생성/로그인할 수단이 없어 결정적으로 실행할 수 없다.
  //
  // 픽스처(역할별 storageState + 시드 데이터) 구축 후 아래를 활성화할 것:
  //   - 일반 회원: /board-room 접근 시 /board 로 리다이렉트(이사/관리자 아님)
  //   - 이사: 대시보드 진입, 안건 추가·회의록 작성·서류 업로드 가능
  //   - 관리자: 회의 생성 → 후보 날짜 투표 → 마감 후 투표 차단 → 날짜 확정(scheduled)
  //   - 출석 체크에 따른 정족수(재적 절반 이상) 충족/미충족 배지 계산
  //   - 회의록 편집은 작성자/관리자만, 안건 수정은 제안자/관리자만
  // ---------------------------------------------------------------------------
  test.fixme('역할별 CRUD·투표·정족수 플로우 (인증 storageState 픽스처 필요)', async () => {
    // 픽스처 구축 시 구현
  })
})
