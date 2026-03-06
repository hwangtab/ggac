/**
 * 파일명 정제 유틸리티
 * Supabase Storage에서 허용되지 않는 문자들을 안전한 형태로 변환
 */

/**
 * 한글을 영문으로 변환하는 매핑 테이블
 */
const koreanToEnglishMap: Record<string, string> = {
  // 자음
  ㄱ: 'g',
  ㄲ: 'gg',
  ㄴ: 'n',
  ㄷ: 'd',
  ㄸ: 'dd',
  ㄹ: 'r',
  ㅁ: 'm',
  ㅂ: 'b',
  ㅃ: 'bb',
  ㅅ: 's',
  ㅆ: 'ss',
  ㅇ: 'ng',
  ㅈ: 'j',
  ㅉ: 'jj',
  ㅊ: 'ch',
  ㅋ: 'k',
  ㅌ: 't',
  ㅍ: 'p',
  ㅎ: 'h',

  // 모음
  ㅏ: 'a',
  ㅐ: 'ae',
  ㅑ: 'ya',
  ㅒ: 'yae',
  ㅓ: 'eo',
  ㅔ: 'e',
  ㅕ: 'yeo',
  ㅖ: 'ye',
  ㅗ: 'o',
  ㅘ: 'wa',
  ㅙ: 'wae',
  ㅚ: 'oe',
  ㅛ: 'yo',
  ㅜ: 'u',
  ㅝ: 'wo',
  ㅞ: 'we',
  ㅟ: 'wi',
  ㅠ: 'yu',
  ㅡ: 'eu',
  ㅢ: 'ui',
  ㅣ: 'i',

  // 완성형 한글 (일반적인 단어들)
  알: 'al',
  수: 'su',
  없: 'eobs',
  는: 'neun',
  느: 'neu',
  낌: 'kkim',
  커: 'keo',
  버: 'beo',
  픽: 'pik',
  셀: 'sel',
  이: 'i',
  미: 'mi',
  지: 'ji',
  테: 'te',
  스: 'seu',
  트: 'teu',
  파: 'pa',
  일: 'il',
  업: 'eob',
  로: 'ro',
  드: 'deu',
  다: 'da',
  운: 'un',
  마: 'ma',
  크: 'keu',
}

/**
 * 한글 문자를 영문으로 변환
 */
function transliterateKorean(text: string): string {
  let result = ''

  for (const char of text) {
    // 한글 완성형 문자 (가-힣)
    if (char >= '가' && char <= '힣') {
      // 매핑 테이블에서 찾기
      if (koreanToEnglishMap[char]) {
        result += koreanToEnglishMap[char]
      } else {
        // 매핑되지 않은 한글은 음성학적 변환
        const code = char.charCodeAt(0) - 0xac00
        const jong = code % 28
        const jung = ((code - jong) / 28) % 21
        const cho = ((code - jong) / 28 - jung) / 21

        const choArr = [
          'g',
          'gg',
          'n',
          'd',
          'dd',
          'r',
          'm',
          'b',
          'bb',
          's',
          'ss',
          '',
          'j',
          'jj',
          'ch',
          'k',
          't',
          'p',
          'h',
        ]
        const jungArr = [
          'a',
          'ae',
          'ya',
          'yae',
          'eo',
          'e',
          'yeo',
          'ye',
          'o',
          'wa',
          'wae',
          'oe',
          'yo',
          'u',
          'wo',
          'we',
          'wi',
          'yu',
          'eu',
          'ui',
          'i',
        ]
        const jongArr = [
          '',
          'g',
          'gg',
          'gs',
          'n',
          'nj',
          'nh',
          'd',
          'r',
          'rg',
          'rm',
          'rb',
          'rs',
          'rt',
          'rp',
          'rh',
          'm',
          'b',
          'bs',
          's',
          'ss',
          'ng',
          'j',
          'ch',
          'k',
          't',
          'p',
          'h',
        ]

        result += choArr[cho] + jungArr[jung] + jongArr[jong]
      }
    }
    // 한글 자모 (ㄱ-ㅣ)
    else if ((char >= 'ㄱ' && char <= 'ㅎ') || (char >= 'ㅏ' && char <= 'ㅣ')) {
      result += koreanToEnglishMap[char] || char
    }
    // 한글이 아닌 문자는 그대로
    else {
      result += char
    }
  }

  return result
}

/**
 * 파일명을 Storage에서 안전한 형태로 정제
 */
export function sanitizeFileName(originalFileName: string): string {
  // 1. 파일 확장자 분리
  const lastDotIndex = originalFileName.lastIndexOf('.')
  const baseName = lastDotIndex > 0 ? originalFileName.substring(0, lastDotIndex) : originalFileName
  const extension = lastDotIndex > 0 ? originalFileName.substring(lastDotIndex) : ''

  // 2. 한글을 영문으로 변환
  let sanitized = transliterateKorean(baseName)

  // 3. 특수문자 처리
  sanitized = sanitized
    // 괄호 제거
    .replace(/[()（）]/g, '')
    // 공백을 하이픈으로
    .replace(/\s+/g, '-')
    // URL-unsafe 문자를 하이픈으로
    .replace(/[^a-zA-Z0-9\-_.]/g, '-')
    // 연속된 하이픈을 하나로
    .replace(/-+/g, '-')
    // 시작/끝 하이픈 제거
    .replace(/^-+|-+$/g, '')

  // 4. 빈 문자열 방지
  if (!sanitized) {
    sanitized = 'file'
  }

  // 5. 길이 제한 (Storage 제한 고려)
  if (sanitized.length > 100) {
    sanitized = sanitized.substring(0, 100)
  }

  return sanitized + extension
}

/**
 * 고유한 파일명 생성 (타임스탬프 + 랜덤 문자열 포함)
 */
export function generateUniqueFileName(originalFileName: string): string {
  const sanitizedName = sanitizeFileName(originalFileName)
  const timestamp = Date.now()
  const randomString = Math.random().toString(36).substring(2, 8)

  // 확장자 분리
  const lastDotIndex = sanitizedName.lastIndexOf('.')
  const baseName = lastDotIndex > 0 ? sanitizedName.substring(0, lastDotIndex) : sanitizedName
  const extension = lastDotIndex > 0 ? sanitizedName.substring(lastDotIndex) : ''

  return `${timestamp}-${randomString}-${baseName}${extension}`
}

/**
 * 파일명 정제 결과 정보
 */
export interface FileNameSanitizationResult {
  original: string
  sanitized: string
  hasChanges: boolean
}

/**
 * 파일명 정제 과정의 상세 정보 반환
 */
export function sanitizeFileNameWithDetails(originalFileName: string): FileNameSanitizationResult {
  const sanitized = sanitizeFileName(originalFileName)

  return {
    original: originalFileName,
    sanitized,
    hasChanges: originalFileName !== sanitized,
  }
}
