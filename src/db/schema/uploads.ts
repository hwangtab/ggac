import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

import { createdAt, updatedAt, uuidPk } from './_shared.ts'
import { memberProfiles } from './identity.ts'

/**
 * 에디터 업로드 원장.
 *
 * `/api/media/upload` POST는 오랫동안 Blob에 올리고 URL만 돌려줬다. 어떤 표에도
 * 참조가 남지 않았고 DELETE도 없었다 — 그래서 **에디터에 삽입되지 않은 업로드는
 * 추적할 방법 자체가 없는 영구 고아**가 됐다. 파일이 참조되는 유일한 흔적은
 * 게시글 본문(`posts.content`)에 박힌 URL 문자열뿐이라, 무엇이 쓰이고 무엇이
 * 버려졌는지 물어볼 대상이 없었다.
 *
 * 이 표는 그 질문을 받을 대상이다. 업로드가 일어난 사실을 기록해 두면
 * 정리 크론(`/api/internal/uploads/cleanup`)이 "올라왔지만 아무 데서도
 * 참조하지 않는 파일"을 골라낼 수 있다.
 *
 * 이 표는 **파일의 존재 기록**이지 소유권 판정이 아니다. 쿼리 계층과 마찬가지로
 * 권한을 모른다 — 접근 판정은 라우트가 한다.
 */
export const mediaUploads = sqliteTable(
  'media_uploads',
  {
    id: uuidPk(),
    /**
     * 올린 사람. 회원이 탈퇴해도 파일 기록은 남아야 정리 대상으로 잡힌다 —
     * 그래서 cascade가 아니라 set null이다(회원과 함께 행이 사라지면 Blob에만
     * 파일이 남는 고아가 다시 생긴다).
     */
    userId: text('user_id').references(() => memberProfiles.id, { onDelete: 'set null' }),
    /** `attachments` · `profiles` 등 업로드 라우트의 논리 버킷. */
    bucket: text('bucket').notNull(),
    /** Blob 논리 경로(`<bucket>/<key>`가 아니라 버킷 안의 key). */
    path: text('path').notNull(),
    /** 본문에 박히는 절대 URL. 정리 판정이 이 문자열로 참조를 찾으므로 유일해야 한다. */
    url: text('url').notNull().unique(),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    // 사용자별 업로드 조회, 그리고 정리 크론의 "오래된 것부터" 스캔.
    index('media_uploads_user_idx').on(table.userId),
    index('media_uploads_created_idx').on(table.createdAt),
  ]
)

/**
 * 시각 컬럼 메모 — `_shared.ts`의 `createdAt()`/`updatedAt()`은 SQL DEFAULT를
 * 만들지 않고 `$defaultFn`으로 Drizzle이 값을 채운다. 그래서 마이그레이션 SQL
 * 쪽에는 `DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))`를 손으로
 * 넣어 **Drizzle을 거치지 않는 쓰기**(마이그레이션 백필·turso 셸·복구 스크립트)가
 * NOT NULL로 죽지 않게 했다. `src/db/schema/auth.ts`의 표들이 이미 그 형태다.
 */
