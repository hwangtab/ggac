/**
 * 채널 파일 탭의 폴더 경로 규약(순수). DB CHECK(attachments_folder_path_check, 0022)와 같은 규칙이다.
 * 경로는 `/` 구분, 앞뒤 슬래시·빈 구간·`.`/`..` 구간·제어문자·역슬래시 금지, 1~1000자. 루트 = ''.
 */
export const MAX_FOLDER_PATH_LENGTH = 1000

/** DB 에 저장 가능한(비어 있지 않은) 폴더 경로인가 */
export function isValidFolderPath(path: string): boolean {
  if (path.length < 1 || path.length > MAX_FOLDER_PATH_LENGTH) return false
  if (/[\u0000-\u001f\\]/.test(path)) return false
  return path.split('/').every(seg => seg !== '' && seg !== '.' && seg !== '..')
}

/** URL `?path=` 값 → 폴더 경로. 없으면 ''(루트), 잘못된 값은 null(호출부가 루트로 돌린다). */
export function parseFolderParam(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw
  if (!v) return ''
  return isValidFolderPath(v) ? v : null
}

/** 경로 → 브레드크럼 조각(루트 제외). path 는 그 조각까지의 누적 경로. */
export function folderCrumbs(path: string): { name: string; path: string }[] {
  if (!path) return []
  const parts = path.split('/')
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }))
}

/** 상위 폴더 경로. 최상위 폴더의 부모는 ''(루트). */
export function parentFolder(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

/** 자료실 폴더 모드 머리글 — 하위 폴더 파일까지 센 사이드바 숫자와 헷갈리지 않게 "바로 있는" 직속 수임을 밝힌다 */
export function folderSummary(
  path: string,
  fileCount: number,
  subfolderCount: number,
  hasMore = false
): string {
  const where = path ? '이 폴더에 바로 있는 파일' : '최상위에 바로 있는 파일'
  const sub = subfolderCount > 0 ? ` · 하위 폴더 ${subfolderCount.toLocaleString('ko-KR')}개` : ''
  return `${where} ${fileCount.toLocaleString('ko-KR')}개${hasMore ? ' 이상' : ''}${sub}`
}

/** 하위 폴더 경로 */
export function childFolder(path: string, name: string): string {
  return path ? `${path}/${name}` : name
}

/** 이관 relPath 의 폴더(파일명 제외). 루트 직속이거나 규약에 안 맞으면 null. */
export function folderPathOfRel(relPath: string): string | null {
  const i = relPath.lastIndexOf('/')
  if (i < 0) return null
  const dir = relPath.slice(0, i)
  return isValidFolderPath(dir) ? dir : null
}
