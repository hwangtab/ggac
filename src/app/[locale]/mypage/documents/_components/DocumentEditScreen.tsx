'use client'

import { useRef } from 'react'
import {
  addMemberDocumentVersion,
  createMemberDocument,
  markEditorUsed,
  memberDocumentFileUrl,
  uploadMemberDocumentFile,
  type PromoteResponse,
} from '@/lib/memberDocuments/client'
import AppEditScreen, { type AppEditSave } from '@work/components/files/app-edit/AppEditScreen'
import type { AppEditorKind } from '@work/lib/files/app-edit'

export type EditTarget =
  | { kind: 'existing'; documentId: string; versionId: string; versionNo: number }
  | { kind: 'new'; templatePath: string }

export type EditorKind = AppEditorKind

/**
 * 내 문서 앱 안 편집 화면(docs/board-work/04-조합원-문서함.md §8·§9). 머리줄·편집기 프레임·상태 문구는 이사회 서류 앱
 * 편집과 함께 쓰는 `AppEditScreen`이 그리고(05 §7), 여기서는 **문서함식 저장**만 정한다: 저장본을 비공개 저장소에 직접
 * 올리고 → 새 문서(처음 저장)·새 버전으로 승격한다. 혼자 쓰는 문서함이라 '수정 중' 표시(checkout)는 없다 — 다른 탭에서
 * 먼저 저장했으면 서버가 409 로 막는다. 편집기를 연 브라우저는 로그아웃 때 편집기 출처 저장소를 비우도록 표식을 남긴다.
 */
export default function DocumentEditScreen({
  target,
  editor,
  fileName,
  backHref,
}: {
  target: EditTarget
  editor: EditorKind
  fileName: string
  backHref: string
}) {
  const documentId = useRef<string | null>(target.kind === 'existing' ? target.documentId : null)

  const save: AppEditSave = async (file, { baseVersionNo, report }) => {
    report('저장본을 올리는 중…')
    const uploadId = await uploadMemberDocumentFile(file, {
      documentId: documentId.current ?? undefined,
      onProgress: r => report(`저장본을 올리는 중… ${Math.round(r * 100)}%`),
    })
    report(editor.kind === 'hwp' ? '저장본을 검사하는 중…' : '저장하는 중…')
    let saved: PromoteResponse
    if (!documentId.current) {
      saved = await createMemberDocument(uploadId, 'editor')
      documentId.current = saved.documentId
      // 주소만 편집 화면으로 바꾼다(라우터로 옮기면 편집기가 다시 로드된다) — 새로 고치면 이 문서가 열린다
      window.history.replaceState(
        null,
        '',
        window.location.pathname.replace(/\/new$/, `/${saved.documentId}/edit`)
      )
    } else {
      saved = await addMemberDocumentVersion(documentId.current, {
        uploadId,
        source: 'editor',
        baseVersionNo,
      })
    }
    return {
      versionNo: saved.versionNo,
      name: saved.name,
      objectsDropped: saved.objectsDropped,
      exitHref: `/mypage/documents/${saved.documentId}`,
    }
  }

  return (
    <AppEditScreen
      editor={editor}
      fileName={fileName}
      sourceUrl={
        target.kind === 'existing'
          ? memberDocumentFileUrl(target.versionId, { download: true })
          : target.templatePath
      }
      initialVersionNo={target.kind === 'existing' ? target.versionNo : null}
      exitHref={target.kind === 'existing' ? `/mypage/documents/${target.documentId}` : backHref}
      save={save}
      testId="member-document-edit-screen"
      onMount={markEditorUsed}
    />
  )
}
