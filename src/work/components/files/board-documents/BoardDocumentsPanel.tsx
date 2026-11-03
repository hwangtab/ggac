'use client'

import { useRef, useState } from 'react'
import { DownloadIcon, EyeIcon, Trash2Icon, UploadIcon } from 'lucide-work'
import { DataTable, TBody, Td, Th, THead, Tr } from '@work/components/layout/data-table'
import { EmptyState } from '@work/components/layout/page'
import { Badge } from '@work/components/ui/badge'
import { Button, buttonVariants } from '@work/components/ui/button'
import ConfirmDialog from '@work/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@work/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@work/components/ui/field'
import { Input } from '@work/components/ui/input'
import { NativeSelect } from '@work/components/ui/native-select'
import { useRouter } from '@work/lib/nav/navigation'
import { BOARD_VISIBILITY_LABEL } from '@work/lib/files/board-folders'
import { FILE_KIND_LABEL, fileKindOf, formatBytes } from '@work/lib/files/mime'
import { formatDateTime } from '@work/lib/format/datetime'
import FileIcon from '../FileIcon'
import FilePreviewBody from '../FilePreviewBody'
import { BOARD_DOCUMENT_API_BASE, FileApiBaseContext } from '../file-api-base'

export type BoardDocumentItem = {
  id: string
  title: string
  fileName: string
  size: number
  mime: string
  visibility: string
  uploaderId: string | null
  uploaderName: string
  createdAt: string
}

/** 기존 서류 다운로드 라우트 — 매 요청 권한을 다시 본다(서명 URL 없음) */
function downloadHref(id: string): string {
  return `/api/board-room/documents/${id}/download`
}

/**
 * 자료실 '이사회 서류' 폴더의 목록·미리보기·올리기·지우기(03 §10). 데이터는 서버(BoardDocumentsFolder)가 준다.
 * 미리보기는 업무툴 첨부와 같은 부품(FilePreviewBody — 이미지·PDF·텍스트·HWP·DOCX·XLSX)을 이사회 서류 라우트
 * (`/api/board-room/work/board-documents/<id>…`)로 돌린다. 올리기·지우기는 기존 서류함 API다.
 */
export default function BoardDocumentsPanel({
  category,
  items,
  meId,
  isAdmin,
  canUpload,
  openDocId,
}: {
  category: string
  items: BoardDocumentItem[]
  meId: string
  isAdmin: boolean
  canUpload: boolean
  /** 검색 결과에서 왔으면 그 서류의 미리보기를 연다 */
  openDocId: string | null
}) {
  const router = useRouter()
  const [uploadOpen, setUploadOpen] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(openDocId)
  const [deleting, setDeleting] = useState<BoardDocumentItem | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const preview = items.find(i => i.id === previewId) ?? null

  async function remove(doc: BoardDocumentItem) {
    setDeleting(null)
    try {
      const res = await fetch(`/api/board-room/documents/${doc.id}`, { method: 'DELETE' })
      const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string }
      if (!res.ok || !json?.success) throw new Error(json?.error || '서류를 지우지 못했습니다.')
      setNotice({ kind: 'ok', text: `'${doc.title}'을(를) 지웠습니다.` })
      router.refresh()
    } catch (e) {
      setNotice({
        kind: 'error',
        text: e instanceof Error ? e.message : '서류를 지우지 못했습니다.',
      })
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-subtle-foreground">
          서류함·정기총회와 같은 자료입니다. 조합원 공개 자료는 조합원도 &lsquo;조합 서류&rsquo;에서
          봅니다.
        </p>
        {canUpload && (
          <Button
            type="button"
            variant={uploadOpen ? 'outline' : 'default'}
            aria-expanded={uploadOpen}
            onClick={() => setUploadOpen(v => !v)}
          >
            <UploadIcon aria-hidden="true" />
            {uploadOpen ? '닫기' : '서류 올리기'}
          </Button>
        )}
      </div>

      {canUpload && uploadOpen && (
        <BoardDocumentUploadForm
          category={category}
          isAdmin={isAdmin}
          onUploaded={title => {
            setUploadOpen(false)
            setNotice({ kind: 'ok', text: `'${title}'을(를) 올렸습니다.` })
            router.refresh()
          }}
        />
      )}

      {notice && (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={notice.kind === 'error' ? 'text-sm text-destructive' : 'text-sm'}
        >
          {notice.text}
        </p>
      )}

      {items.length === 0 ? (
        <EmptyState compact bordered title="이 폴더에는 서류가 없습니다." />
      ) : (
        <DataTable caption={`이사회 서류 — ${category}`} className="@container">
          <THead>
            <Th>제목</Th>
            <Th className="hidden @2xl:table-cell">올린 사람</Th>
            <Th className="hidden @lg:table-cell">열람</Th>
            <Th numeric className="hidden @md:table-cell">
              크기
            </Th>
            <Th className="hidden @4xl:table-cell">올린 날짜</Th>
            <Th className="text-right">
              <span className="sr-only">동작</span>
            </Th>
          </THead>
          <TBody>
            {items.map(doc => {
              const canDelete = isAdmin || (doc.uploaderId !== null && doc.uploaderId === meId)
              return (
                <Tr key={doc.id} interactive data-board-document={doc.id}>
                  <Td className="min-w-48">
                    <button
                      type="button"
                      onClick={() => setPreviewId(doc.id)}
                      aria-label={`${doc.title} 미리보기`}
                      className="flex w-full items-start gap-2 text-left outline-none focus-visible:underline"
                    >
                      <FileIcon
                        mime={doc.mime}
                        name={doc.fileName}
                        size={doc.size}
                        className="mt-0.5 shrink-0"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium break-all">{doc.title}</span>
                        <span className="block text-xs break-all text-muted-foreground">
                          {doc.fileName}
                          <span className="@md:hidden"> · {formatBytes(doc.size)}</span>
                        </span>
                      </span>
                    </button>
                  </Td>
                  <Td className="hidden @2xl:table-cell">{doc.uploaderName}</Td>
                  <Td className="hidden @lg:table-cell">
                    <Badge variant={doc.visibility === 'members' ? 'success' : 'secondary'}>
                      {BOARD_VISIBILITY_LABEL[doc.visibility] ?? doc.visibility}
                    </Badge>
                  </Td>
                  <Td numeric className="hidden @md:table-cell">
                    {formatBytes(doc.size)}
                  </Td>
                  <Td nowrap className="hidden @4xl:table-cell">
                    {formatDateTime(doc.createdAt)}
                  </Td>
                  <Td nowrap className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${doc.title} 미리보기`}
                        title="미리보기"
                        onClick={() => setPreviewId(doc.id)}
                      >
                        <EyeIcon aria-hidden="true" />
                      </Button>
                      <a
                        href={downloadHref(doc.id)}
                        download={doc.fileName}
                        aria-label={`${doc.title} 다운로드`}
                        title="다운로드"
                        className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
                      >
                        <DownloadIcon aria-hidden="true" />
                      </a>
                      {canDelete && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${doc.title} 삭제`}
                          title="삭제"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleting(doc)}
                        >
                          <Trash2Icon aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </TBody>
        </DataTable>
      )}

      <BoardDocumentPreviewDialog doc={preview} onClose={() => setPreviewId(null)} />

      <ConfirmDialog
        open={deleting !== null}
        title="서류를 지울까요?"
        description={
          deleting
            ? `'${deleting.title}'이(가) 서류함·자료실 어디에서도 사라집니다. 되돌릴 수 없습니다.`
            : ''
        }
        confirmLabel="삭제"
        onConfirm={() => deleting && remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}

function BoardDocumentPreviewDialog({
  doc,
  onClose,
}: {
  doc: BoardDocumentItem | null
  onClose: () => void
}) {
  const file = doc ? { id: doc.id, name: doc.fileName, mime: doc.mime, size: doc.size } : null
  const kind = file ? fileKindOf(file.mime, file.name, file.size) : 'other'
  return (
    <Dialog open={doc !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="flex h-[min(90dvh,900px)] w-[min(96vw,1100px)] max-w-none flex-col gap-4 overflow-hidden sm:max-w-none">
        {doc && file && (
          <>
            <div className="flex min-h-12 items-center gap-2 pr-10">
              <FileIcon mime={file.mime} name={file.name} size={file.size} />
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate">{doc.title}</DialogTitle>
                <DialogDescription className="truncate">
                  {file.name} · {FILE_KIND_LABEL[kind]} · {formatBytes(file.size)} ·{' '}
                  {BOARD_VISIBILITY_LABEL[doc.visibility] ?? doc.visibility}
                </DialogDescription>
              </div>
              <a
                href={downloadHref(doc.id)}
                download={file.name}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                <DownloadIcon aria-hidden="true" />
                다운로드
              </a>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-w-lg bg-subtle">
              <FileApiBaseContext.Provider value={BOARD_DOCUMENT_API_BASE}>
                <FilePreviewBody key={file.id} file={file} />
              </FileApiBaseContext.Provider>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** 서류함 올리기(`DocumentUpload`)와 같은 입력·같은 API. 분류는 이 폴더로 고정이다 */
function BoardDocumentUploadForm({
  category,
  isAdmin,
  onUploaded,
}: {
  category: string
  isAdmin: boolean
  onUploaded: (title: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [visibility, setVisibility] = useState('board')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!file) return setError('파일을 선택해 주세요.')
    if (!title.trim()) return setError('제목을 입력해 주세요.')
    setPending(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('title', title.trim())
      form.append('category', category)
      form.append('visibility', visibility)
      // Content-Type 을 직접 넣지 않는다 — 브라우저가 multipart 경계를 붙인다
      const res = await fetch('/api/board-room/documents', { method: 'POST', body: form })
      const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string }
      if (!res.ok || !json?.success) {
        setError(json?.error || '서류를 올리지 못했습니다.')
        return
      }
      const done = title.trim()
      setFile(null)
      setTitle('')
      setVisibility('board')
      if (fileRef.current) fileRef.current.value = ''
      onUploaded(done)
    } catch {
      setError('서류를 올리지 못했습니다.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={`${category}에 서류 올리기`}
      className="space-y-4 rounded-w-lg border bg-card p-4"
    >
      <Field>
        <FieldLabel htmlFor="board-doc-file">파일</FieldLabel>
        <Input
          id="board-doc-file"
          ref={fileRef}
          type="file"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
          className="h-9"
          aria-describedby="board-doc-file-hint"
        />
        <FieldDescription id="board-doc-file-hint">
          PDF·이미지·Word·Excel·한글(HWP)·텍스트, 최대 50MB
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="board-doc-title">제목</FieldLabel>
        <Input
          id="board-doc-title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          maxLength={200}
          placeholder="예: 2026년 정관 개정본"
          className="h-9"
        />
      </Field>
      {isAdmin && (
        <Field>
          <FieldLabel htmlFor="board-doc-visibility">열람 범위</FieldLabel>
          <NativeSelect
            id="board-doc-visibility"
            value={visibility}
            onChange={e => setVisibility(e.target.value)}
            aria-describedby="board-doc-visibility-hint"
          >
            <option value="board">이사회만(이사·감사·관리자)</option>
            <option value="members">조합원 공개(승인된 조합원 전체)</option>
          </NativeSelect>
          <FieldDescription id="board-doc-visibility-hint">
            재무 원자료처럼 내부에만 둘 것은 이사회만으로 두십시오.
          </FieldDescription>
        </Field>
      )}
      {error && <FieldError role="alert">{error}</FieldError>}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? '올리는 중…' : `${category}에 올리기`}
        </Button>
      </div>
    </form>
  )
}
