import { sanitizeJsonLd } from './sanitize';

// 테스트 환경에서 jest 전역 함수가 사용 가능하다고 가정
describe('sanitizeJsonLd', () => {
  test('should sanitize strings by removing HTML tags and escaping special characters', () => {
    const input = '<script>alert("XSS")</script>Hello & World';
    const expected = '<script>alert("XSS")</script>Hello & World';
    expect(sanitizeJsonLd(input)).toBe(expected);
  });

  test('should truncate long strings to 500 characters', () => {
    const longString = 'a'.repeat(600);
    expect(sanitizeJsonLd(longString).length).toBe(500);
  });

  test('should sanitize arrays recursively', () => {
    const input = [
      'safe string',
      '<b>unsafe</b>',
      { key: '<script>alert(1)</script>' }
    ];
    
    const expected = [
      'safe string',
      '<b>unsafe</b>',
      { key: '<script>alert(1)</script>' }
    ];
    
    expect(sanitizeJsonLd(input)).toEqual(expected);
  });

  test('should sanitize objects recursively', () => {
    const input = {
      name: '<em>John</em>',
      contact: {
        email: 'john@example.com',
        phone: '<script>1234</script>'
      },
      tags: ['<b>tag1</b>', 'tag2']
    };
    
    const expected = {
      name: '<em>John</em>',
      contact: {
        email: 'john@example.com',
        phone: '<script>1234</script>'
      },
      tags: ['<b>tag1</b>', 'tag2']
    };
    
    expect(sanitizeJsonLd(input)).toEqual(expected);
  });

  test('should handle nested arrays and objects', () => {
    const input = {
      data: [
        { value: '<div>test</div>' },
        { items: ['<a href="#">link</a>'] }
      ]
    };
    
    const expected = {
      data: [
        { value: '<div>test</div>' },
        { items: ['<a href="#">link</a>'] }
      ]
    };
    
    expect(sanitizeJsonLd(input)).toEqual(expected);
  });

  test('should return non-string values as-is', () => {
    expect(sanitizeJsonLd(123)).toBe(123);
    expect(sanitizeJsonLd(null)).toBe(null);
    expect(sanitizeJsonLd(undefined)).toBe(undefined);
    expect(sanitizeJsonLd(true)).toBe(true);
  });
});