import { test } from 'node:test'
import assert from 'node:assert/strict'

// 이식 도구(scripts/work/port-from-kosmart.mjs)의 Tailwind v4 → v3 변환. 틀리면 화면이 조용히 깨진다 —
// 빌드는 통과하고 클래스만 생성되지 않는다. 그래서 원본에서 실제로 나온 모양을 못박는다.
const { convertToken, convertClassString, rewriteSpecifier, transformSource } = await import(
  '../work/port-from-kosmart.mjs'
)

test('유틸리티 이름 변환', () => {
  assert.equal(convertToken('outline-hidden'), 'outline-none')
  assert.equal(convertToken('focus-visible:ring-3'), 'focus-visible:ring')
  assert.equal(convertToken('shadow-sm'), 'shadow')
  assert.equal(convertToken('shadow-xs'), 'shadow-sm')
  assert.equal(convertToken('backdrop-blur-xs'), 'backdrop-blur-sm')
  assert.equal(convertToken('field-sizing-content'), '[field-sizing:content]')
  assert.equal(convertToken('w-(--anchor-width)'), 'w-[var(--anchor-width)]')
  assert.equal(convertToken('origin-(--transform-origin)'), 'origin-[var(--transform-origin)]')
})

test('열고 닫는 애니메이션은 업무툴 전용 wa-* 로(공개 사이트 클래스와 섞이지 않게)', () => {
  assert.equal(convertToken('animate-out'), 'wa-out')
  assert.equal(convertToken('data-closed:fade-out-0'), 'data-closed:wa-fade-out-0')
  assert.equal(convertToken('data-open:zoom-in-95'), 'data-open:wa-zoom-in-95')
  assert.equal(
    convertToken('data-[side=bottom]:slide-in-from-top-2'),
    'data-[side=bottom]:wa-slide-in-from-top-2'
  )
  assert.equal(convertToken('animate-spin'), 'animate-spin')
})

test('반경은 업무툴 전용 이름으로(ggac 전역 rounded-lg와 값이 다르다)', () => {
  assert.equal(convertToken('rounded-lg'), 'rounded-w-lg')
  assert.equal(convertToken('rounded-b-xl'), 'rounded-b-w-xl')
  assert.equal(convertToken('rounded-4xl'), 'rounded-w-4xl')
  assert.equal(convertToken('rounded-full'), 'rounded-full')
  assert.equal(convertToken('rounded'), 'rounded')
  assert.equal(convertToken('rounded-none'), 'rounded-none')
})

test('v4 뒤쪽 ! 는 v3 앞쪽 ! 로', () => {
  assert.equal(convertToken('px-2!'), '!px-2')
  assert.equal(convertToken('rounded-xl!'), '!rounded-w-xl')
  assert.equal(convertToken('hover:h-8!'), 'hover:!h-8')
})

test('변형 변환', () => {
  assert.equal(
    convertToken('aria-invalid:border-destructive'),
    'aria-[invalid=true]:border-destructive'
  )
  assert.equal(convertToken('data-open:animate-in'), 'data-open:wa-in') // shadcn 의미 변형은 플러그인이 정의
  assert.equal(convertToken('data-inset:pl-7'), 'data-[inset]:pl-7')
  assert.equal(convertToken('has-data-[icon=inline-end]:pr-2'), 'has-[[data-icon=inline-end]]:pr-2')
  assert.equal(convertToken('has-disabled:opacity-50'), 'has-[:disabled]:opacity-50')
  assert.equal(
    convertToken('supports-backdrop-filter:backdrop-blur-xs'),
    'supports-[backdrop-filter]:backdrop-blur-sm'
  )
  assert.equal(
    convertToken('group-data-selected/command-item:text-foreground'),
    'group-data-[selected=true]/command-item:text-foreground'
  )
  assert.equal(
    convertToken('in-data-[slot=button-group]:rounded-lg'),
    '[[data-slot=button-group]_&]:rounded-w-lg'
  )
})

test('선택자를 바꾸는 변형이 겹치면 순서를 뒤집는다(v4 왼쪽부터 · v3 오른쪽부터)', () => {
  // 원본: 초점 받은 요소의 자손 글자색
  assert.equal(
    convertToken('focus:**:text-accent-foreground'),
    '[&_*]:focus:text-accent-foreground'
  )
  // 원본: 선택된 항목의 자식 중 svg
  assert.equal(
    convertToken('data-selected:*:[svg]:text-foreground'),
    '[&:is(svg)]:*:data-selected:text-foreground'
  )
  // 원본: 자손 중 cmdk 그룹 제목
  assert.equal(
    convertToken('**:[[cmdk-group-heading]]:px-2'),
    '[&:is([cmdk-group-heading])]:[&_*]:px-2'
  )
  // 미디어·의사 클래스끼리는 순서를 두고 바꾸지 않는다
  assert.equal(convertToken('dark:hover:bg-muted/50'), 'dark:hover:bg-muted/50')
  assert.equal(convertToken('md:focus-visible:ring-3'), 'md:focus-visible:ring')
})

test('클래스가 아닌 문자열은 건드리지 않는다', () => {
  for (const s of [
    'channel:abc',
    'https://ggac.kr/a:b',
    '**주의:** 내용',
    '오후 3:00',
    'channels/x/pending/y',
    'outline', // cva 변형 이름(variant: 'outline')
    'Content-Type',
  ]) {
    assert.equal(convertClassString(s), s, s)
  }
})

test('import 경로 변환', () => {
  assert.equal(rewriteSpecifier('@/lib/utils'), '@work/lib/utils')
  assert.equal(rewriteSpecifier('@/components/ui/button'), '@work/components/ui/button')
  assert.equal(rewriteSpecifier('@/types/supabase'), '@work/types/supabase')
  assert.equal(rewriteSpecifier('lucide-react'), 'lucide-work')
  assert.equal(rewriteSpecifier('@/app/x'), '@/app/x')
  assert.equal(rewriteSpecifier('react'), 'react')
})

test('소스 변환은 문자열·import만 바꾼다', () => {
  const src = [
    "'use client';",
    "import { X } from 'lucide-react';",
    "import { cn } from '@/lib/utils';",
    'const rounded = 1; // rounded-lg 주석은 그대로',
    'export const C = () => <div className={cn("rounded-lg outline-hidden", `px-2! ${a}`)} />;',
  ].join('\n')
  const out = transformSource(src, 'x.tsx')
  assert.match(out, /from 'lucide-work'/)
  assert.match(out, /from '@work\/lib\/utils'/)
  assert.match(out, /rounded-lg 주석은 그대로/)
  assert.match(out, /"rounded-w-lg outline-none"/)
  assert.match(out, /`!px-2 \$\{a\}`/)
})
