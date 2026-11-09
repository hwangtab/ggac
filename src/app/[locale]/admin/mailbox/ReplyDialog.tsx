import { FiX } from 'react-icons/fi'

import { replySubject } from '@/lib/mail/replyCompose'

import { TemplatePicker, type ReplyTemplate } from './TemplateManager'
import { inputClass } from './mailboxTypes'
import type { ReplyDraft } from './hooks/useReplyDraft'

/** 답장 모달 — 관리자만 그린다(부모가 `canManage`로 거른다). */
export default function ReplyDialog({
  reply,
  templates,
}: {
  reply: ReplyDraft
  templates: ReplyTemplate[]
}) {
  const {
    replyTarget,
    replyBody,
    setReplyBody,
    replySending,
    replyAll,
    setReplyAll,
    includeQuote,
    setIncludeQuote,
    replySource,
    replyPreview,
    closeReply,
    sendReply,
  } = reply
  if (!replyTarget) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={e => {
        if (e.target === e.currentTarget) closeReply()
      }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">답장 보내기</h2>
          <button
            onClick={closeReply}
            aria-label="닫기"
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <FiX className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-sm text-gray-500 space-y-1" data-testid="reply-recipients">
            <div>
              받는 사람:{' '}
              <span className="text-gray-900 break-all">
                {replyPreview?.to ?? '(주소를 알 수 없음)'}
              </span>
              {replyPreview && replyPreview.to !== replyTarget.from_email && (
                <span className="ml-1 text-xs text-gray-400">(회신 주소)</span>
              )}
            </div>
            {replyAll && (
              <div>
                참조:{' '}
                <span className="text-gray-900 break-all">
                  {replyPreview && replyPreview.cc.length > 0
                    ? replyPreview.cc.join(', ')
                    : '(없음)'}
                </span>
              </div>
            )}
            {replyAll && replyPreview && replyPreview.dropped.length > 0 && (
              <div className="text-xs text-amber-700">
                참조에서 뺀 주소(형식이 틀렸거나 참조 상한을 넘었습니다):{' '}
                {replyPreview.dropped.join(', ')}
              </div>
            )}
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={replyAll}
                onChange={e => setReplyAll(e.target.checked)}
                className="rounded border-gray-300"
              />
              전체 답장 (원본의 받는 사람·참조에게도 보내기, 우리 주소 제외)
            </label>
          </div>
          <div className="text-sm text-gray-500">
            제목: <span className="text-gray-900">{replySubject(replyTarget.subject)}</span>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="block text-xs font-medium text-gray-600">
                본문 <span className="text-red-500">*</span>
              </label>
              <TemplatePicker
                templates={templates}
                disabled={replySending}
                body={replyBody}
                onChange={setReplyBody}
              />
            </div>
            <textarea
              rows={10}
              value={replyBody}
              onChange={e => setReplyBody(e.target.value)}
              placeholder="답장 내용을 입력하세요."
              className={`${inputClass} resize-none`}
            />
          </div>
          {replySource?.body_text ? (
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={includeQuote}
                onChange={e => setIncludeQuote(e.target.checked)}
                className="rounded border-gray-300"
              />
              원문 인용 (받은 메일의 글자만 붙입니다)
            </label>
          ) : (
            <p className="text-xs text-gray-400">
              이 메일은 글자 본문이 없어 원문을 인용하지 않습니다.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-gray-200">
          <button
            onClick={closeReply}
            disabled={replySending}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            취소
          </button>
          <button
            onClick={sendReply}
            disabled={replySending || !replyBody.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {replySending ? '보내는 중...' : '보내기'}
          </button>
        </div>
      </div>
    </div>
  )
}
