/**
 * ggac 이식 2a 자리표시 — 자료실·채널 파일 탭의 "이전 버전 포함" 토글(원본 `versions/VersionsToggle.tsx`)은
 * 3단계(버전)다. 2a 의 첨부는 모두 v1 이라 토글할 것이 없어 그리지 않는다. `?versions=all` 주소는 그대로 동작한다.
 * 3단계에서 원본을 옮길 때는 `port-from-kosmart.mjs --force`로 이 파일을 덮어쓴다.
 */
export default function VersionsToggle(_props: {
  active: boolean
  href: string
  className?: string
}) {
  return null
}
