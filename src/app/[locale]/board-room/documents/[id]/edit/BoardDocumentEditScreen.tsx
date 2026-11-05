'use client'

import { saveBoardDocumentEdit } from '@/lib/boardDocuments/client'
import AppEditScreen, { type AppEditSave } from '@work/components/files/app-edit/AppEditScreen'
import type { AppEditorKind } from '@work/lib/files/app-edit'

/**
 * 이사회 서류 앱 편집 화면(docs/board-work/05-이사회-서류-앱-편집.md §7). 머리줄·편집기·상태 문구는 내 문서함과 같은
 * `AppEditScreen`이 그리고, 여기서는 **서류식 저장**만 정한다: 저장본을 서류 버전 키에 직접 올리고 → `/versions`가
 * 검사한 뒤 새 버전으로 만든다(처음 저장이면 지금 파일이 v1 기록이 된다). 원본은 기존 다운로드 라우트(매 요청 권한 재검사)
 * 에서 받는다.
 */
export default function BoardDocumentEditScreen({
  documentId,
  editor,
  fileName,
  versionNo,
  hasBody,
}: {
  documentId: string
  editor: AppEditorKind
  fileName: string
  versionNo: number
  hasBody: boolean
}) {
  const save: AppEditSave = async (file, { baseVersionNo, report }) => {
    report('저장본을 올리는 중…')
    const saved = await saveBoardDocumentEdit(documentId, file, {
      baseVersionNo,
      onProgress: r => report(`저장본을 올리는 중… ${Math.round(r * 100)}%`),
      onStage: () => report(editor.kind === 'hwp' ? '저장본을 검사하는 중…' : '저장하는 중…'),
    })
    return {
      versionNo: saved.versionNo,
      name: saved.name,
      objectsDropped: saved.objectsDropped,
      notice:
        hasBody && saved.bodyUpdated === false
          ? '웹 본문은 새 파일로 다시 만들지 못해 이전 본문을 그대로 두었습니다.'
          : undefined,
    }
  }

  return (
    <AppEditScreen
      mobileNote="휴대전화에서는 서류를 내려받을 수 있습니다."
      editor={editor}
      fileName={fileName}
      sourceUrl={`/api/board-room/documents/${documentId}/download`}
      initialVersionNo={versionNo}
      exitHref={`/board-room/documents/${documentId}`}
      save={save}
      testId="board-document-edit-screen"
    />
  )
}
