/**
 * CSP Nonce Manager
 *
 * 서버 시작 시 한 번만 nonce 생성 → 전체 인스턴스에서 공유.
 * - 정적 prerender 호환: headers() 호출 없이 nonce 값 접근 가능
 * - 보안: 서버 재시작 시 nonce 갱신 (공격 창 제한)
 * - 단일 인스턴스 내 nonce 공유는 acceptable — 이 웹사이트는
 *   사용자 입력 삽입 경로가 에디터에만 집중되어 있고,
 *   에디터 경로에서도 nonce 누출 시 다음 재시작까지 제한된 창만 노출됨.
 */

function generateNonce(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

// 서버 시작 시 한 번 생성 — module singleton
export const cspNonce: string = generateNonce()
