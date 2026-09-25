/**
 * 표지 업로드 라우트 테스트용 세션 스텁.
 *
 * 진짜 `@/lib/server/memberAuth`는 쿠키에서 Better Auth 세션을 읽는다. 단위
 * 테스트에는 요청을 보내는 브라우저가 없으므로 이 자리만 바꿔 끼운다 —
 * 나머지(기능 스위치·캠페인 조회·소유 판정·매직 바이트·저장 경로)는 전부
 * 진짜 코드가 돈다.
 */
import { NextResponse } from 'next/server'

export async function requireActiveMember() {
  const session = globalThis.__coverTestSession
  if (!session) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  return { user: { id: session.id }, profile: session.profile }
}

export async function requireUser() {
  return requireActiveMember()
}

export async function getOptionalUser() {
  const session = globalThis.__coverTestSession
  return session ? { id: session.id } : null
}

// 표지 라우트는 소유자 게이트로 이걸 쓴다 — 로그인·프로필만 본다.
export async function requireCampaignActor() {
  return requireActiveMember()
}
