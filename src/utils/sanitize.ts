/**
 * JSON-LD 데이터 정제 유틸리티
 * XSS 공격 방지를 위해 재귀적으로 데이터를 정제합니다.
 * 
 * @param value 정제할 데이터 (문자열, 배열, 객체 등)
 * @returns 안전하게 정제된 데이터
 */
export function sanitizeJsonLd(value: any): any {
  // 문자열 처리
  if (typeof value === 'string') {
    return value
      .replace(/<[^>]*>/g, '') // HTML 태그 제거
      .replace(/[<>"'&]/g, (char) => { // 특수 문자 HTML 엔티티로 변환
        const map: Record<string, string> = {
          '<': '<',
          '>': '>',
          '"': '"',
          "'": '&#x27;',
          '&': '&'
        };
        return map[char] || char;
      })
      .slice(0, 500); // 길이 제한
  }
  
  // 배열 처리
  if (Array.isArray(value)) {
    return value.map(item => sanitizeJsonLd(item));
  }
  
  // 객체 처리
  if (value && typeof value === 'object') {
    const sanitized: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      sanitized[key] = sanitizeJsonLd(val);
    }
    return sanitized;
  }
  
  // 기타 타입은 그대로 반환
  return value;
}