import { FiX } from 'react-icons/fi'

import { SHORTCUT_HELP } from './shortcuts'

/** 키보드 단축키 도움말(`?`). */
export default function ShortcutHelpDialog({
  canManage,
  onClose,
}: {
  canManage: boolean
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-label="키보드 단축키"
        className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-3 text-sm"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">키보드 단축키</h2>
          <button
            onClick={() => onClose()}
            aria-label="닫기"
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            <FiX className="w-5 h-5" />
          </button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          {SHORTCUT_HELP.filter(item => canManage || !item.manageOnly).map(item => (
            <div key={item.keys} className="contents">
              <dt>
                <kbd className="rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-xs">
                  {item.keys}
                </kbd>
              </dt>
              <dd className="text-gray-700">{item.label}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-gray-400">
          받은 메일함에서 동작합니다. 글을 쓰는 중에는 동작하지 않습니다.
        </p>
      </div>
    </div>
  )
}
