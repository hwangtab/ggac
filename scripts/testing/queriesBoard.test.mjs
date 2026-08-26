import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations } from './apply-migrations.mjs'

/**
 * `src/db/queries/board.ts`를 실제 SQLite 파일 DB로 검증한다. 패턴은
 * `scripts/testing/queriesActivities.test.mjs`(단계 4 Task 3)와 동일.
 */

const DB_PATH = 'scripts/testing/.queries-board-test.db'
const BOARD_MODULE_URL = new URL('../../src/db/queries/board.ts', import.meta.url)
const PROFILES_MODULE_URL = new URL('../../src/db/queries/profiles.ts', import.meta.url)

async function loadFreshBoardModule() {
  return import(`${BOARD_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}
async function loadFreshProfilesModule() {
  return import(`${PROFILES_MODULE_URL.href}?t=${Date.now()}-${Math.random()}`)
}

let setupClient

before(async () => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
  setupClient = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(setupClient)
})

after(() => {
  setupClient?.close()
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${DB_PATH}${suffix}`, { force: true })
})

// ---------------------------------------------------------------- 부정 대조: 깨진 경로

test('부정 대조 기반: listMeetings이 실제로 DB에 접속하지 못하면 던진다(조용히 삼키지 않는다)', async () => {
  const original = process.env.TURSO_DATABASE_URL
  process.env.TURSO_DATABASE_URL = 'file:/definitely-nonexistent-dir-ggac-2c/broken.db'
  try {
    const { listMeetings } = await loadFreshBoardModule()
    await assert.rejects(() => listMeetings())
  } finally {
    process.env.TURSO_DATABASE_URL = original
  }
})

// ---------------------------------------------------------------- 실제 DB 대상 테스트

process.env.TURSO_DATABASE_URL = `file:${DB_PATH}`

let seedCounter = 0
async function seedProfile(overrides = {}) {
  const { upsertProfile } = await loadFreshProfilesModule()
  const id = overrides.id ?? `board-profile-${++seedCounter}`
  await upsertProfile({
    id,
    email: `${id}@test.local`,
    display_name: overrides.display_name ?? '이사회테스트회원',
    registration_status: 'approved',
    is_active: true,
  })
  return id
}

// -------------------------------------------------------------- board_meetings

test('createMeeting → getMeetingById → listMeetings(created_at desc)', async () => {
  const creator = await seedProfile()
  const { createMeeting, getMeetingById, listMeetings } = await loadFreshBoardModule()

  const first = await createMeeting({
    title: '1차 회의',
    location: null,
    voteDeadline: new Date(Date.now() + 86400000),
    createdBy: creator,
  })
  await new Promise(r => setTimeout(r, 5))
  const second = await createMeeting({
    title: '2차 회의',
    location: '사무실',
    voteDeadline: new Date(Date.now() + 86400000),
    createdBy: creator,
  })

  const fetched = await getMeetingById(first.id)
  assert.equal(fetched.title, '1차 회의')
  assert.equal(fetched.status, 'polling', 'status는 polling으로 시작해야 한다')

  const list = await listMeetings()
  const idxSecond = list.findIndex(m => m.id === second.id)
  const idxFirst = list.findIndex(m => m.id === first.id)
  assert.ok(idxSecond < idxFirst, '최신 회의가 먼저 나와야 한다(created_at desc)')
})

test('updateMeeting: 부분 갱신 후 title/meeting_date를 돌려준다. 존재하지 않으면 null', async () => {
  const creator = await seedProfile()
  const { createMeeting, updateMeeting } = await loadFreshBoardModule()
  const meeting = await createMeeting({
    title: '원제목',
    location: null,
    voteDeadline: new Date(),
    createdBy: creator,
  })

  const updated = await updateMeeting(meeting.id, {
    title: '새 제목',
    meetingDate: '2026-09-01',
    status: 'scheduled',
  })
  assert.equal(updated.title, '새 제목')
  assert.equal(updated.meeting_date, '2026-09-01')

  const missing = await updateMeeting('00000000-0000-0000-0000-000000000000', { title: 'x' })
  assert.equal(missing, null)
})

test('deleteMeeting: 존재하는 회의를 지운다(멱등 — 다시 지워도 에러 없음)', async () => {
  const creator = await seedProfile()
  const { createMeeting, deleteMeeting, getMeetingById } = await loadFreshBoardModule()
  const meeting = await createMeeting({
    title: '삭제될 회의',
    location: null,
    voteDeadline: new Date(),
    createdBy: creator,
  })
  await deleteMeeting(meeting.id)
  assert.equal(await getMeetingById(meeting.id), null)
  await assert.doesNotReject(() => deleteMeeting(meeting.id))
})

// -------------------------------------------------------------- date options / votes

test('createDateOptions → listDateOptions(candidate_date asc) → getDateOptionByMeetingAndDate', async () => {
  const creator = await seedProfile()
  const { createMeeting, createDateOptions, listDateOptions, getDateOptionByMeetingAndDate } =
    await loadFreshBoardModule()
  const meeting = await createMeeting({
    title: '날짜투표',
    location: null,
    voteDeadline: new Date(),
    createdBy: creator,
  })
  await createDateOptions(meeting.id, ['2026-09-05', '2026-09-01', '2026-09-03'])

  const options = await listDateOptions(meeting.id)
  assert.deepEqual(
    options.map(o => o.candidate_date),
    ['2026-09-01', '2026-09-03', '2026-09-05']
  )

  const found = await getDateOptionByMeetingAndDate(meeting.id, '2026-09-03')
  assert.ok(found)
  const missing = await getDateOptionByMeetingAndDate(meeting.id, '2026-12-25')
  assert.equal(missing, null)
})

test('upsertDateVote: 같은 (option, voter)로 두 번 투표하면 최신 값으로 덮어쓴다', async () => {
  const creator = await seedProfile()
  const voter = await seedProfile()
  const {
    createMeeting,
    createDateOptions,
    listDateOptions,
    upsertDateVote,
    listDateVotesByOptionIds,
  } = await loadFreshBoardModule()
  const meeting = await createMeeting({
    title: '투표회의',
    location: null,
    voteDeadline: new Date(),
    createdBy: creator,
  })
  await createDateOptions(meeting.id, ['2026-10-01'])
  const [option] = await listDateOptions(meeting.id)

  await upsertDateVote(option.id, voter, true)
  await upsertDateVote(option.id, voter, false)

  const votes = await listDateVotesByOptionIds([option.id])
  assert.equal(votes.length, 1, '중복 투표가 새 행을 만들면 안 된다')
  assert.equal(votes[0].is_available, false)
})

test('getMeetingVotingState: status/vote_deadline을 돌려준다', async () => {
  const creator = await seedProfile()
  const deadline = new Date(Date.now() + 3600_000)
  const { createMeeting, getMeetingVotingState } = await loadFreshBoardModule()
  const meeting = await createMeeting({
    title: '상태확인',
    location: null,
    voteDeadline: deadline,
    createdBy: creator,
  })
  const state = await getMeetingVotingState(meeting.id)
  assert.equal(state.status, 'polling')
  assert.equal(new Date(state.vote_deadline).getTime(), deadline.getTime())
})

// -------------------------------------------------------------- attendees

test('upsertMeetingAttendees: 다건 upsert가 excluded로 각 행의 값을 정확히 반영한다(고정값 오염 없음)', async () => {
  const creator = await seedProfile()
  const memberA = await seedProfile()
  const memberB = await seedProfile()
  const { createMeeting, upsertMeetingAttendees, listMeetingAttendees } =
    await loadFreshBoardModule()
  const meeting = await createMeeting({
    title: '출석회의',
    location: null,
    voteDeadline: new Date(),
    createdBy: creator,
  })

  await upsertMeetingAttendees(meeting.id, [
    { member_id: memberA, attended: true },
    { member_id: memberB, attended: false },
  ])
  let rows = await listMeetingAttendees(meeting.id)
  assert.equal(rows.find(r => r.member_id === memberA).attended, true)
  assert.equal(rows.find(r => r.member_id === memberB).attended, false)

  // 재호출: A는 false로, B는 true로 뒤집는다 — 각 행이 "자기 자신의" excluded
  // 값으로 갱신되는지 확인한다(고정된 하나의 값으로 전부 덮이면 이 단언이 깨진다).
  await upsertMeetingAttendees(meeting.id, [
    { member_id: memberA, attended: false },
    { member_id: memberB, attended: true },
  ])
  rows = await listMeetingAttendees(meeting.id)
  assert.equal(rows.find(r => r.member_id === memberA).attended, false)
  assert.equal(rows.find(r => r.member_id === memberB).attended, true)
  assert.equal(rows.length, 2, '중복 upsert가 새 행을 만들면 안 된다')
})

// -------------------------------------------------------------- agendas

test('createAgenda → getLastAgendaSortOrder → listAgendasByMeeting(sort_order asc)', async () => {
  const creator = await seedProfile()
  const { createMeeting, createAgenda, getLastAgendaSortOrder, listAgendasByMeeting } =
    await loadFreshBoardModule()
  const meeting = await createMeeting({
    title: '안건회의',
    location: null,
    voteDeadline: new Date(),
    createdBy: creator,
  })

  assert.equal(await getLastAgendaSortOrder(meeting.id), null, '안건이 없으면 null')

  await createAgenda({
    meetingId: meeting.id,
    title: '안건1',
    content: null,
    sortOrder: 0,
    proposedBy: creator,
  })
  assert.equal(await getLastAgendaSortOrder(meeting.id), 0)
  await createAgenda({
    meetingId: meeting.id,
    title: '안건2',
    content: null,
    sortOrder: 1,
    proposedBy: creator,
  })

  const list = await listAgendasByMeeting(meeting.id)
  assert.deepEqual(
    list.map(a => a.title),
    ['안건1', '안건2']
  )
  assert.equal(list[0].status, 'proposed')
})

test('getAgendaOwner: 행이 없으면 undefined(404 대상), proposed_by가 NULL이면 null(관리자만 허용), 있으면 소유자 id', async () => {
  const creator = await seedProfile()
  const { createMeeting, createAgenda, getAgendaOwner } = await loadFreshBoardModule()
  const meeting = await createMeeting({
    title: '소유권회의',
    location: null,
    voteDeadline: new Date(),
    createdBy: creator,
  })
  const agenda = await createAgenda({
    meetingId: meeting.id,
    title: '소유권안건',
    content: null,
    sortOrder: 0,
    proposedBy: creator,
  })

  assert.equal(await getAgendaOwner(agenda.id), creator)
  assert.equal(
    await getAgendaOwner('00000000-0000-0000-0000-000000000000'),
    undefined,
    '행이 없으면 undefined여야 한다(404) — null과 구분해야 한다'
  )

  // proposed_by를 NULL로 직접 되돌려(고아 안건 재현) null과 undefined를 구분한다.
  await setupClient.execute({
    sql: 'UPDATE board_agendas SET proposed_by = NULL WHERE id = ?',
    args: [agenda.id],
  })
  assert.equal(
    await getAgendaOwner(agenda.id),
    null,
    '행은 있지만 소유자가 없으면 null이어야 한다(관리자만 수정 가능, 404가 아니다)'
  )
})

test('updateAgenda / deleteAgenda', async () => {
  const creator = await seedProfile()
  const { createMeeting, createAgenda, updateAgenda, deleteAgenda, listAgendasByMeeting } =
    await loadFreshBoardModule()
  const meeting = await createMeeting({
    title: '수정삭제회의',
    location: null,
    voteDeadline: new Date(),
    createdBy: creator,
  })
  const agenda = await createAgenda({
    meetingId: meeting.id,
    title: '원안건',
    content: null,
    sortOrder: 0,
    proposedBy: creator,
  })

  await updateAgenda(agenda.id, { title: '수정된안건', status: 'discussed' })
  let list = await listAgendasByMeeting(meeting.id)
  assert.equal(list[0].title, '수정된안건')
  assert.equal(list[0].status, 'discussed')

  await deleteAgenda(agenda.id)
  list = await listAgendasByMeeting(meeting.id)
  assert.equal(list.length, 0)
})

// -------------------------------------------------------------- minutes

test('createMinutes → getMinutesIdByMeetingId(중복 방지) → getMinutesByMeetingId', async () => {
  const creator = await seedProfile()
  const { createMeeting, createMinutes, getMinutesIdByMeetingId, getMinutesByMeetingId } =
    await loadFreshBoardModule()
  const meeting = await createMeeting({
    title: '회의록회의',
    location: null,
    voteDeadline: new Date(),
    createdBy: creator,
  })

  assert.equal(await getMinutesIdByMeetingId(meeting.id), null)
  const minutes = await createMinutes({
    meetingId: meeting.id,
    content: '내용',
    contentFormat: 'markdown',
    authorId: creator,
  })
  assert.equal(await getMinutesIdByMeetingId(meeting.id), minutes.id)

  const fetched = await getMinutesByMeetingId(meeting.id)
  assert.equal(fetched.content, '내용')
  assert.equal(fetched.content_format, 'markdown')
  assert.equal(fetched.author_id, creator)
})

// 단계 4 Task 6b: 같은 회의에 회의록을 두 번 올리는 경쟁(사전 검사와 INSERT
// 사이에 다른 이사가 먼저 올린 경우)이 500이 아니라 409로 나가야 한다.
// 라우트가 그 판단에 쓰는 판별 함수를 실제 제약 위반으로 검증한다.
test('isDuplicateMinutesError: 실제 meeting_id UNIQUE 위반을 잡는다', async () => {
  const creator = await seedProfile()
  const { createMeeting, createMinutes, isDuplicateMinutesError } = await loadFreshBoardModule()
  const meeting = await createMeeting({
    title: '중복회의록회의',
    location: null,
    voteDeadline: new Date(),
    createdBy: creator,
  })
  await createMinutes({
    meetingId: meeting.id,
    content: '먼저 올린 회의록',
    contentFormat: 'markdown',
    authorId: creator,
  })

  let caught
  await assert.rejects(
    () =>
      createMinutes({
        meetingId: meeting.id,
        content: '나중에 올린 회의록',
        contentFormat: 'markdown',
        authorId: creator,
      }),
    error => {
      caught = error
      return true
    }
  )
  assert.equal(isDuplicateMinutesError(caught), true)
})

test('isDuplicateMinutesError: 다른 종류의 실패는 잡지 않는다(499를 409로 둔갑시키지 않는다)', async () => {
  const { createMinutes, isDuplicateMinutesError } = await loadFreshBoardModule()

  // ① 없는 회의 id — FK 위반이지 중복이 아니다.
  let fkError
  await assert.rejects(
    () =>
      createMinutes({
        meetingId: 'no-such-meeting',
        content: '내용',
        contentFormat: 'markdown',
        authorId: null,
      }),
    error => {
      fkError = error
      return true
    }
  )
  assert.equal(isDuplicateMinutesError(fkError), false)

  // ② 다른 표의 UNIQUE 위반 — 메시지 앞부분("UNIQUE constraint failed")만
  // 보는 구현이면 여기서 통과해 버린다.
  assert.equal(
    isDuplicateMinutesError(
      new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: member_profiles.email')
    ),
    false
  )
  assert.equal(isDuplicateMinutesError(new Error('연결이 끊겼습니다')), false)
  assert.equal(isDuplicateMinutesError(null), false)
})

test('회의록 생성 라우트가 중복 위반을 409로 매핑한다 (소스 가드)', () => {
  const route = readFileSync('src/app/api/board-room/minutes/route.ts', 'utf8')
  // 판별 함수만 만들어 두고 라우트가 안 쓰면 사용자는 여전히 500을 본다.
  assert.match(route, /isDuplicateMinutesError\(createError\)/)
  assert.match(route, /ApiError\.conflict\('이미 회의록이 존재합니다\.'\)/)
  // 원인을 통째로 버리던 옛 형태(`} catch {`)로 되돌아가면 매핑이 사라진다.
  assert.doesNotMatch(route, /minutes = await createMinutes\([\s\S]*?\}\)\n\s*\} catch \{/)
})

test('getMinutesAuthorAndFormat: author_id가 NULL인 고아 회의록도 정확히 구분한다(null vs 행없음)', async () => {
  const creator = await seedProfile()
  const { createMeeting, createMinutes, getMinutesAuthorAndFormat } = await loadFreshBoardModule()
  const meeting = await createMeeting({
    title: '고아회의록회의',
    location: null,
    voteDeadline: new Date(),
    createdBy: creator,
  })
  const minutes = await createMinutes({
    meetingId: meeting.id,
    content: '내용',
    contentFormat: 'plain',
    authorId: creator,
  })

  assert.equal(
    await getMinutesAuthorAndFormat('00000000-0000-0000-0000-000000000000'),
    null,
    '행이 없으면 null이어야 한다'
  )

  await setupClient.execute({
    sql: 'UPDATE board_minutes SET author_id = NULL WHERE id = ?',
    args: [minutes.id],
  })
  const row = await getMinutesAuthorAndFormat(minutes.id)
  assert.notEqual(row, null, '행 자체는 있으므로 객체를 돌려줘야 한다')
  assert.equal(row.author_id, null, 'author_id는 null이어야 한다(undefined로 뭉개면 안 된다)')
})

test('updateMinutes / deleteMinutes', async () => {
  const creator = await seedProfile()
  const { createMeeting, createMinutes, updateMinutes, deleteMinutes, getMinutesByMeetingId } =
    await loadFreshBoardModule()
  const meeting = await createMeeting({
    title: '수정삭제회의록회의',
    location: null,
    voteDeadline: new Date(),
    createdBy: creator,
  })
  const minutes = await createMinutes({
    meetingId: meeting.id,
    content: '원본',
    contentFormat: 'plain',
    authorId: creator,
  })

  await updateMinutes(minutes.id, { content: '수정됨' })
  let fetched = await getMinutesByMeetingId(meeting.id)
  assert.equal(fetched.content, '수정됨')

  await deleteMinutes(minutes.id)
  fetched = await getMinutesByMeetingId(meeting.id)
  assert.equal(fetched, null)
})

// -------------------------------------------------------------- documents

test('createDocument → listDocuments(카테고리 필터/제외) → getDocumentForDownload/Delete → deleteDocument', async () => {
  const uploader = await seedProfile()
  const {
    createDocument,
    listDocuments,
    getDocumentForDownload,
    getDocumentForDelete,
    deleteDocument,
  } = await loadFreshBoardModule()

  const doc1 = await createDocument({
    title: '일반서류',
    category: 'general',
    filePath: `${uploader}/file1.pdf`,
    fileName: 'file1.pdf',
    fileSize: 1000,
    mimeType: 'application/pdf',
    uploadedBy: uploader,
  })
  await createDocument({
    title: '총회서류',
    category: 'assembly',
    filePath: `${uploader}/file2.pdf`,
    fileName: 'file2.pdf',
    fileSize: 2000,
    mimeType: 'application/pdf',
    uploadedBy: uploader,
  })

  const generalOnly = await listDocuments({ category: 'general' })
  assert.ok(generalOnly.every(d => d.category === 'general'))

  const excludingAssembly = await listDocuments({ excludeCategory: 'assembly' })
  assert.ok(!excludingAssembly.some(d => d.category === 'assembly'))
  assert.ok(excludingAssembly.some(d => d.id === doc1.id))

  const downloadInfo = await getDocumentForDownload(doc1.id)
  assert.equal(downloadInfo.file_path, `${uploader}/file1.pdf`)
  assert.equal(downloadInfo.file_name, 'file1.pdf')

  const deleteInfo = await getDocumentForDelete(doc1.id)
  assert.equal(deleteInfo.uploaded_by, uploader)

  await deleteDocument(doc1.id)
  assert.equal(await getDocumentForDownload(doc1.id), null)
})

test('getDocumentForDelete/getDocumentForDownload: 존재하지 않으면 null', async () => {
  const { getDocumentForDelete, getDocumentForDownload } = await loadFreshBoardModule()
  assert.equal(await getDocumentForDelete('00000000-0000-0000-0000-000000000000'), null)
  assert.equal(await getDocumentForDownload('00000000-0000-0000-0000-000000000000'), null)
})
