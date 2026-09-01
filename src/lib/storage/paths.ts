export type PutPublicObjectOptions = {
  /**
   * 같은 경로에 이미 객체가 있어도 덮어쓸지. 기본은 false — 있으면 업로드가
   * 실패한다. @vercel/blob put()의 allowOverwrite 옵션도 명시하지 않으면
   * 실패하므로("조용한 덮어쓰기 금지"), 여기서도 그 기본을 그대로 따른다.
   * 정말로 덮어써야 하는 호출부만 명시적으로 { overwrite: true }를 넘겨야 한다.
   */
  overwrite?: boolean
}

/** putPublicObject 옵션에서 실제 overwrite 여부를 뽑는다. opts 자체가 없거나
 * overwrite가 없으면 false — "덮어쓰기 금지"가 기본이라는 점을 여기 한 곳에서만
 * 결정한다. */
export function resolveOverwrite(opts?: PutPublicObjectOptions): boolean {
  return opts?.overwrite === true
}

export type VariantPathSuffixes = {
  originalPath: string
  webpPath: string
  fallbackPath: string
}

/**
 * 베이스 경로(prefix) 아래에 원본 파일명 + webp/JPEG 폴백 변형 3종의 경로를
 * 만든다. `media/upload`와 `mypage/artist/photo` 두 라우트가 이 명명 규칙을
 * 그대로 공유한다 — 확장자 판별 방식은 라우트마다 다르므로(하나는
 * `path.extname`, 하나는 `split('.').pop()`) `nameWithoutExtension`은 항상
 * 호출부가 계산해서 넘긴다. 이 함수는 세 경로 문자열을 조립하는 마지막
 * 단계만 담당한다.
 *
 * **구조적 성질**: `originalFileName`이 이미 `.webp`로 끝나면
 * `originalPath === webpPath`가 된다 — 버그가 아니라 이 명명 규칙 자체의
 * 성질이다(webp 변형 경로도 결국 `${basePrefix}/${nameWithoutExtension}.webp`이고,
 * 원본이 이미 webp라면 원본 경로도 정확히 그 문자열이기 때문). 그래서 이 두
 * 라우트의 webp/JPEG 폴백 변형 업로드는 `putPublicObject(..., { overwrite: true })`를
 * 명시적으로 넘겨야 한다 — 원본 업로드가 먼저 그 경로를 차지한 뒤, 변형
 * 업로드가 같은 경로에 재기록해야 하기 때문이다. 원본 업로드 자체는 계속
 * 기본값(`overwrite: false`)을 쓴다 — 그 경로가 이미 차 있으면 정말로
 * 실패해야 하는 쓰기다.
 */
export function buildVariantPathSuffixes(
  basePrefix: string,
  originalFileName: string,
  nameWithoutExtension: string
): VariantPathSuffixes {
  return {
    originalPath: `${basePrefix}/${originalFileName}`,
    webpPath: `${basePrefix}/${nameWithoutExtension}.webp`,
    fallbackPath: `${basePrefix}/${nameWithoutExtension}.fallback.jpg`,
  }
}

export function splitBucketPath(pathname: string): { bucket: string; key: string } {
  if (typeof pathname !== 'string' || !pathname || pathname.startsWith('/')) {
    throw new Error(`invalid pathname: ${JSON.stringify(pathname)}`)
  }
  const segments = pathname.split('/')
  if (segments.length < 2 || segments.some(s => s === '' || s === '..' || s === '.')) {
    throw new Error(`invalid pathname: ${JSON.stringify(pathname)}`)
  }
  return { bucket: segments[0], key: segments.slice(1).join('/') }
}

/**
 * Vercel Blob 공개 저장소의 URL인지 판정한다. origin을 정확히 대조하므로
 * 접미사 위조(`...vercel-storage.com.evil.com`)와 userinfo 트릭에 견딘다.
 * NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL이 없으면 항상 false다.
 *
 * `NEXT_PUBLIC_` 접두사가 붙는 이유: 이 판정 결과에 기대는 렌더 게이트 다수가
 * 'use client' 컴포넌트(PostAttachmentsDisplay, AttachmentCard, ImageModal,
 * useAttachmentActions, PersonalInfo, toSafeArtistImageSrc 호출부)에서 돈다.
 * 접두사가 없는 이름은 Next.js가 클라이언트 번들에 인라인하지 않아 브라우저에서
 * 이 함수가 항상 false를 반환했다 — 서버 렌더는 정상이던 것과 어긋나 하이드레이션
 * 불일치를 냈다(최종 리뷰 Finding 1).
 */
export function isBlobPublicUrl(value: string): boolean {
  const base = process.env.NEXT_PUBLIC_BLOB_PUBLIC_BASE_URL
  if (!base || typeof value !== 'string' || !value) return false

  try {
    return new URL(value).origin === new URL(base).origin
  } catch {
    return false
  }
}

/**
 * 저장된 절대 URL에서 논리 경로 `<bucket>/<key>`를 되돌린다.
 * 기대한 버킷·접두사와 다르면 null을 준다.
 * 이 확인은 기존 getProjectStorageObjectPath가 하던 봉쇄를 유지하기 위한 것이다.
 *
 * **Supabase 형식(`/storage/v1/object/public/<bucket>/<key>`) 인식은 걷어냈다.**
 * 저장된 URL을 Blob으로 재작성하는 컷오버가 끝난 뒤 운영 DB를 실측해
 * 남은 Supabase 절대 URL이 0건임을 확인했고(2026-09-01에는 Supabase
 * 프로젝트 자체도 삭제됐다), 그 가지는 이제 도달하지 않는다. 남겨두면
 * 판정 근거가 사라진 환경변수(NEXT_PUBLIC_SUPABASE_URL)에 계속 매여 있게 된다.
 */
export function logicalPathFromUrl(
  url: string,
  expectedBucket: string,
  pathPrefix = ''
): string | null {
  if (typeof url !== 'string' || !url) return null
  if (!isBlobPublicUrl(url)) return null

  let logical: string | null = null
  try {
    logical = decodeURIComponent(new URL(url).pathname.replace(/^\/+/, '')) || null
  } catch {
    return null
  }

  if (!logical) return null

  let parts
  try {
    parts = splitBucketPath(logical)
  } catch {
    return null
  }

  if (parts.bucket !== expectedBucket) return null

  const normalizedPrefix = pathPrefix.replace(/^\/+|\/+$/g, '')
  if (normalizedPrefix && !parts.key.startsWith(`${normalizedPrefix}/`)) return null

  return logical
}
