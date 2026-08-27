import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 적대 감사(2026-08-27)가 **로컬 스택에서 실제로 실행해** 찾은 쓰기 경로 결함 셋.
 * 컷오버 이후 운영에서 한 번도 안 돈 코드라 아무도 몰랐다.
 *
 * 소스 텍스트 검사인 것을 인정한다 — 이 셋은 라우트 핸들러라 단위 테스트로
 * 부르려면 세션·DB·Blob을 전부 세워야 한다(그건 e2e 몫이다). 대신 **깨졌을 때
 * 무엇이 사라지는지**를 각 단언 메시지에 적어, 지우려는 사람이 대가를 보게 한다.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
const read = p => stripComments(readFileSync(p, 'utf8'))

const commentDelete = read('src/app/api/posts/[id]/comments/[commentId]/route.ts')
const commentCreate = read('src/app/api/posts/[id]/comments/route.ts')
const artistPhoto = read('src/app/api/mypage/artist/photo/route.ts')

test('관리자가 댓글을 지울 수 있다', () => {
  assert.match(
    commentDelete,
    /comment\.author_id !== userId && !isAdmin/,
    '작성자만 허용하면 스팸·비방 댓글을 지울 경로가 0개가 된다 — ' +
      'Postgres 시절 RLS로 대신하던 Supabase 대시보드는 컷오버로 사라졌다'
  )
  assert.match(
    commentDelete,
    /isApprovedActiveAdmin\(/,
    '관리자 판정은 승인·활성까지 봐야 한다(정지된 관리자가 지우면 안 된다)'
  )
})

test('삭제된 글에는 댓글을 쓸 수 없다', () => {
  assert.match(
    commentCreate,
    /post\.is_deleted/,
    '이 검사가 없으면 소프트 삭제된 글에 댓글이 저장된다 — ' +
      '아무도 못 보고 알림도 사라지는데 쓴 사람만 성공했다고 믿는다'
  )
  assert.match(
    commentCreate,
    /if \(!post\) \{/,
    '없는 글에 대한 FK 위반이 그대로 500으로 새어 나간다'
  )
})

test('아티스트 사진은 업로드 전에 아티스트 존재를 판정한다', () => {
  const gateAt = artistPhoto.indexOf('if (!currentArtist)')
  const uploadAt = artistPhoto.indexOf('generateArtistStoragePaths(profile.artist_id')
  assert.ok(gateAt > 0, '아티스트 부재 판정이 없으면 500 + 롤백 경로로 빠진다')
  assert.ok(
    gateAt < uploadAt,
    '판정이 업로드보다 뒤에 오면 유료 스토어에 먼저 올린 뒤 실패한다 — ' +
      '롤백이 실패하면 고아 객체가 남는다'
  )
})

test('아티스트 조회 실패와 부재를 구분한다', () => {
  assert.match(
    artistPhoto,
    /status: 503/,
    'DB 장애를 "아티스트 없음"으로 뭉개면 조합원이 사무국에 헛걸음한다'
  )
  assert.match(artistPhoto, /status: 409/, '끊어진 연결은 조합원이 알 수 있는 메시지여야 한다')
})
