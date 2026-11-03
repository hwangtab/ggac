import Link from '@work/lib/nav/link'
import { FileIcon, FolderLockIcon, MessageSquareIcon, StickyNoteIcon, UserIcon } from 'lucide-work'
import { EmptyState, SectionHeading } from '@work/components/layout/page'
import ChannelLabel from './ChannelLabel'
import DocumentHitList from './DocumentHitList'
import Highlight from './Highlight'
import { formatDateTime } from '@work/lib/format/datetime'
import { formatBytes } from '@work/lib/search/format'
import { buildSearchHref } from '@work/lib/search/params'
import { SENSITIVE_PREVIEW } from '@work/lib/inbox/queries'
import { messageSnippet } from '@work/lib/search/text'
import type { SearchResult } from '@work/lib/search/search'
import { BOARD_VISIBILITY_LABEL, boardFolderHref } from '@work/lib/files/board-folders'

/** 자료실 '이사회 서류'에서 찾은 것(03 §10) — 제목·파일 이름·본문(정관처럼 본문을 둔 서류) */
export type BoardDocumentHit = {
  id: string
  title: string
  category: string
  fileName: string | null
  size: number | null
  visibility: string
  createdAt: string
  bodyMatched: boolean
  /** 파일 속 글자(PDF·HWP·DOCX 등 추출 본문)에서 맞은 검색어가 있다 */
  contentMatched?: boolean
  /** 첫 일치 주변 평문(파일 속 글자가 맞았으면 그쪽, 아니면 웹 본문) */
  snippet?: string
}

const linkClass = 'block px-4 py-3 outline-none hover:bg-accent'

/** 구역이 상한에서 잘렸을 때 */
function MoreNote({ show }: { show?: boolean }) {
  if (!show) return null
  return <p className="text-xs text-muted-foreground">더 있음 — 검색어를 좁혀 보세요.</p>
}

/** 기간 필터는 메시지에만 정확히 걸린다 — 첨부·메모 검색 함수는 기간 인자가 없다 */
function DateNote({ show }: { show?: boolean }) {
  if (!show) return null
  return (
    <p className="rounded-w-lg bg-subtle px-3 py-2 text-xs text-muted-foreground">
      기간은 메시지에 정확히 적용됩니다. 파일(올린 날)·문서 내용(올린 날)·메모(고친 날)는 검색 상위
      결과 중에서만 기간으로 거르므로 일부가 빠질 수 있습니다.
    </p>
  )
}

/** 검색 결과 묶음(메시지·메모·파일·문서 내용·사람). 데이터는 props 로만 받는다. */
export default function SearchResults({
  result,
  boardDocuments = [],
  boardDocumentsMore = false,
  now,
}: {
  result: SearchResult
  /** 자료실 '이사회 서류' 결과(업무툴 검색과 따로 찾는다 — 검색 페이지가 넘긴다) */
  boardDocuments?: BoardDocumentHit[]
  boardDocumentsMore?: boolean
  now?: Date
}) {
  const { messages, files, people, terms } = result
  const notes = result.notes ?? []
  const documents = result.documents ?? []
  const more = result.more
  const total =
    messages.length +
    files.length +
    people.length +
    notes.length +
    documents.length +
    boardDocuments.length

  if (total === 0) {
    return (
      <div className="space-y-4">
        <DateNote show={result.dateFiltered} />
        <div role="status">
          <EmptyState
            compact
            title="검색 결과가 없습니다. 다른 검색어나 필터를 시도해 보세요."
            className="py-12"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <DateNote show={result.dateFiltered} />
      {/* ggac 이식: 검색은 늘 instr AND(원본 'ilike' 간이 모드와 같은 규칙)라 간이 검색 안내 배너를 뺐다 */}

      {messages.length > 0 && (
        <section aria-labelledby="search-messages" className="space-y-3">
          <SectionHeading id="search-messages" count={messages.length}>
            메시지
          </SectionHeading>
          <ul className="space-y-3">
            {messages.map(m => (
              <li key={m.id}>
                <Link href={m.href} className={linkClass}>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <ChannelLabel channel={m.channel} />
                    <span>{m.authorName ?? '알 수 없음'}</span>
                    <time dateTime={m.createdAt}>{formatDateTime(m.createdAt, now)}</time>
                    {m.parentId && (
                      <span className="inline-flex items-center gap-1">
                        <MessageSquareIcon aria-hidden="true" className="size-3.5" />
                        스레드 답글
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-sm break-words">
                    {m.sensitive ? (
                      SENSITIVE_PREVIEW
                    ) : (
                      <Highlight text={messageSnippet(m.body, terms)} terms={terms} />
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <MoreNote show={more?.messages} />
        </section>
      )}

      {notes.length > 0 && (
        <section aria-labelledby="search-notes" className="space-y-3">
          <SectionHeading id="search-notes" count={notes.length}>
            메모
          </SectionHeading>
          <ul className="space-y-3">
            {notes.map(n => (
              <li key={n.id}>
                <Link href={n.href} className={linkClass}>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <ChannelLabel channel={n.channel} />
                    <span className="inline-flex items-center gap-1">
                      <StickyNoteIcon aria-hidden="true" className="size-3.5" />
                      {n.title ?? '메모'}
                    </span>
                    <time dateTime={n.updatedAt}>{formatDateTime(n.updatedAt, now)}</time>
                  </span>
                  <span className="mt-1 block text-sm break-words">
                    <Highlight text={messageSnippet(n.body, terms)} terms={terms} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <MoreNote show={more?.notes} />
        </section>
      )}

      {files.length > 0 && (
        <section aria-labelledby="search-files" className="space-y-3">
          <SectionHeading id="search-files" count={files.length}>
            파일
          </SectionHeading>
          <ul className="space-y-3">
            {files.map(f => (
              <li key={f.id}>
                <Link href={f.href} className={linkClass}>
                  <span className="flex items-center gap-2 text-sm">
                    <FileIcon
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 break-all">
                      <Highlight text={f.name} terms={terms} />
                    </span>
                    {f.oldVersionNo !== undefined && (
                      <span className="shrink-0 rounded-w-lg border px-1 text-xs text-muted-foreground">
                        이전 버전 v{f.oldVersionNo}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    <ChannelLabel channel={f.channel} />
                    <span>{formatBytes(f.size)}</span>
                    <time dateTime={f.createdAt}>{formatDateTime(f.createdAt, now)}</time>
                  </span>
                  {f.snippet && (
                    <span className="mt-1 block text-sm break-words text-muted-foreground">
                      <Highlight text={f.snippet} terms={terms} />
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          <MoreNote show={more?.files} />
        </section>
      )}

      {boardDocuments.length > 0 && (
        <section aria-labelledby="search-board-documents" className="space-y-3">
          <SectionHeading id="search-board-documents" count={boardDocuments.length}>
            이사회 서류
          </SectionHeading>
          <ul className="space-y-3">
            {boardDocuments.map(d => (
              <li key={d.id}>
                <Link href={boardFolderHref(d.category, d.id)} className={linkClass}>
                  <span className="flex items-center gap-2 text-sm">
                    <FolderLockIcon
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 break-all">
                      <Highlight text={d.title} terms={terms} />
                    </span>
                  </span>
                  <span className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    <span>{d.category}</span>
                    {d.fileName && (
                      <span className="break-all">
                        <Highlight text={d.fileName} terms={terms} />
                      </span>
                    )}
                    {d.size !== null && <span>{formatBytes(d.size)}</span>}
                    <span>{BOARD_VISIBILITY_LABEL[d.visibility] ?? d.visibility}</span>
                    <time dateTime={d.createdAt}>{formatDateTime(d.createdAt, now)}</time>
                    {d.contentMatched ? (
                      <span>파일 내용 일치</span>
                    ) : (
                      d.bodyMatched && <span>본문 일치</span>
                    )}
                  </span>
                  {d.snippet && (
                    <span className="mt-1 block text-sm break-words text-muted-foreground">
                      <Highlight text={d.snippet} terms={terms} />
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          <MoreNote show={boardDocumentsMore} />
          <p className="text-xs text-muted-foreground">
            서류함·정기총회 자료의 제목·파일 이름·본문(정관처럼 본문을 둔 서류)과 파일 속
            글자(PDF·HWP·DOCX 등)에서 찾았습니다. 방금 올린 서류의 파일 내용은 잠시 뒤에 찾을 수
            있습니다.
          </p>
        </section>
      )}

      {documents.length > 0 && (
        <section aria-labelledby="search-documents" className="space-y-3">
          <SectionHeading id="search-documents" count={documents.length}>
            문서 내용
          </SectionHeading>
          <DocumentHitList hits={documents} terms={terms} nowMs={now?.getTime()} />
          <MoreNote show={more?.documents} />
          <p className="text-xs text-muted-foreground">
            첨부한 HWP·DOCX·XLSX·PDF·텍스트 파일의 본문에서 찾았습니다. 파일명을 누르면 미리 봅니다.
          </p>
        </section>
      )}

      {people.length > 0 && (
        <section aria-labelledby="search-people" className="space-y-3">
          <SectionHeading id="search-people" count={people.length}>
            사람
          </SectionHeading>
          <ul className="space-y-3">
            {people.map(p => (
              <li key={p.userId}>
                <Link href={buildSearchHref({ author: p.userId })} className={linkClass}>
                  <span className="flex items-center gap-2 text-sm">
                    <UserIcon
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <Highlight text={p.displayName} terms={terms} />
                    {p.title && <span className="text-xs text-muted-foreground">{p.title}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            사람을 누르면 그 사람이 쓴 메시지를 모아 봅니다.
          </p>
          <MoreNote show={more?.people} />
        </section>
      )}
    </div>
  )
}
