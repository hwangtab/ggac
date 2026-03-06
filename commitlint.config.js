module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat', // 새로운 기능
        'fix', // 버그 수정
        'docs', // 문서 수정
        'style', // 코드 포매팅, 세미콜론 누락 등
        'refactor', // 코드 리팩토링
        'test', // 테스트 추가
        'chore', // 빌드 업무, 패키지 매니저 수정
        'perf', // 성능 개선
        'ci', // CI 설정 수정
        'build', // 빌드 시스템 수정
        'revert', // 커밋 되돌리기
      ],
    ],
    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],
    'scope-case': [2, 'always', 'lower-case'],
    'subject-case': [2, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 100],
  },
}
