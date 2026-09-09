#!/usr/bin/env node
/**
 * 로컬 마크다운을 데이터베이스로 들인다.
 *
 * 기본은 마른 실행이다. 무엇을 바꿀지 출력만 하고 끝난다.
 * 실제로 쓰려면 `--apply`를 준다.
 *
 *   node scripts/archive/import-archive-docs.mjs --assembly
 *   node scripts/archive/import-archive-docs.mjs --assembly --apply
 *   node scripts/archive/import-archive-docs.mjs --minutes
 *
 * 이사회는 `--minutes` 전에 반드시 운영 회의 목록을 눈으로 확인해라.
 * 없는 회의를 만들기 때문에, 이미 있는 회의를 못 찾으면 두 벌이 된다.
 */
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createClient } from '@libsql/client'
import { ASSEMBLY_DOCS, BOARD_MINUTES } from './mapping.mjs'

const apply = process.argv.includes('--apply')
const doAssembly = process.argv.includes('--assembly')
const doMinutes = process.argv.includes('--minutes')

if (!doAssembly && !doMinutes) {
  console.error('무엇을 넣을지 골라라: --assembly 또는 --minutes')
  process.exit(1)
}

const url = process.env.TURSO_DATABASE_URL
if (!url) {
  console.error('TURSO_DATABASE_URL이 없다.')
  process.exit(1)
}

/** 토큰·경로를 찍지 않고 대상 DB를 눈으로 확인할 수 있게 호스트만 보여준다. */
function describeTarget(rawUrl) {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol === 'file:') return `file:${parsed.pathname || rawUrl}`
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return rawUrl
  }
}
console.log(`대상 DB: ${describeTarget(url)}`)

const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })

function label() {
  return apply ? '적용' : '마른 실행'
}

function readSource(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`  ✗ 원본 파일이 없다: ${file}`)
      process.exitCode = 1
      return null
    }
    throw err
  }
}

async function importAssembly() {
  console.log(`\n[총회 자료 — ${label()}]`)
  for (const entry of ASSEMBLY_DOCS) {
    const body = readSource(entry.file)
    if (body === null) continue

    const found = await db.execute({
      sql: "select id, title, visibility, length(coalesce(body_markdown, '')) as len from board_documents where title = ? and category = ?",
      args: [entry.matchTitle, '총회'],
    })
    if (found.rows.length === 0) {
      console.error(`  ✗ 제목을 못 찾았다: "${entry.matchTitle}"`)
      const all = await db.execute("select title from board_documents where category = '총회'")
      console.error('    후보:', all.rows.map(r => r.title).join(' / ') || '(없음)')
      process.exitCode = 1
      continue
    }
    if (found.rows.length > 1) {
      console.error(`  ✗ 제목이 여러 건이다: "${entry.matchTitle}" (${found.rows.length}건)`)
      process.exitCode = 1
      continue
    }
    const row = found.rows[0]
    console.log(
      `  ${row.title}: 본문 ${row.len}자 → ${body.length}자, 범위 ${row.visibility} → ${entry.visibility}`
    )
    if (apply) {
      await db.execute({
        sql: 'update board_documents set body_markdown = ?, visibility = ? where id = ?',
        args: [body, entry.visibility, row.id],
      })
    }
  }
}

async function importMinutes() {
  console.log(`\n[이사회 회의록 — ${label()}]`)
  for (const entry of BOARD_MINUTES) {
    const content = readSource(entry.file)
    if (content === null) continue

    const meetings = await db.execute({
      sql: 'select id, title from board_meetings where meeting_date = ?',
      args: [entry.date],
    })
    if (meetings.rows.length > 1) {
      console.error(`  ✗ ${entry.date}에 회의가 여러 건이다. 손으로 정리해라.`)
      process.exitCode = 1
      continue
    }

    let meetingId = meetings.rows[0]?.id
    if (meetingId) {
      if (meetings.rows[0].title !== entry.title) {
        console.warn(
          `  ! 제목이 다르다: DB "${meetings.rows[0].title}" vs 매핑 표 "${entry.title}" (${entry.date})`
        )
      }
      console.log(`  = 기존 회의에 붙임: ${entry.date} ${meetings.rows[0].title}`)
    } else {
      // 날짜로는 못 찾았다. 만들기 전에 제목으로 한 번 더 대조한다 — 운영에
      // 다른 날짜로 기록된 같은 회의가 있으면 두 벌이 생기는 유일한 파괴
      // 경로라, 여기서는 짐작하지 않고 멈춘다.
      const byTitle = await db.execute({
        sql: 'select id, title, meeting_date from board_meetings where title = ?',
        args: [entry.title],
      })
      if (byTitle.rows.length > 0) {
        const other = byTitle.rows[0]
        console.error(
          `  ✗ 같은 제목의 회의가 다른 날짜에 있다: id=${other.id} "${other.title}" (${other.meeting_date}) — 매핑 표 날짜는 ${entry.date}. 만들지 않고 중단한다.`
        )
        process.exitCode = 1
        continue
      }
      console.log(`  + 회의 새로 만듦: ${entry.date} ${entry.title}`)
      meetingId = randomUUID()
      if (apply) {
        await db.execute({
          sql: "insert into board_meetings (id, title, meeting_date, status) values (?, ?, ?, 'completed')",
          args: [meetingId, entry.title, entry.date],
        })
      }
    }

    // 존재 검사는 읽기다 — apply 여부와 무관하게 마른 실행에서도 무엇이
    // 바뀔지(또는 바뀌지 않을지) 보여준다. 새로 만들 회의는 아직 DB에
    // 없으니 당연히 회의록도 없다.
    const existing = await db.execute({
      sql: 'select id from board_minutes where meeting_id = ?',
      args: [meetingId],
    })
    if (existing.rows.length > 0) {
      console.log('    이미 회의록이 있다. 덮지 않고 건너뛴다.')
      continue
    }

    console.log(`    회의록 ${content.length}자 넣을 예정`)
    if (!apply) continue

    await db.execute({
      sql: "insert into board_minutes (id, meeting_id, content, content_format) values (?, ?, ?, 'markdown')",
      args: [randomUUID(), meetingId, content],
    })
  }
}

if (doAssembly) await importAssembly()
if (doMinutes) await importMinutes()

if (process.exitCode) {
  console.log(`\n${label()} 중 실패가 있었다 — 위 ✗ 표시를 확인해라.`)
} else {
  console.log(apply ? '\n적용 끝.' : '\n마른 실행이다. 실제로 쓰려면 --apply를 줘라.')
}
