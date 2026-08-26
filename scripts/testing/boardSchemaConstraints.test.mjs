import { test, before, after, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { createClient } from '@libsql/client'

import { applyMigrations, migrationFiles } from './apply-migrations.mjs'

/**
 * 단계 4 Task 6a — 이사회 스키마 제약(B-9 UNIQUE / B-10 ON DELETE)이 **실제로
 * 무는지** 로컬 파일 DB에서 증명한다.
 *
 * "마이그레이션이 에러 없이 돌았다"는 증명이 아니다. 그래서 이 파일은 전부
 * 동작으로 확인한다:
 *   · UNIQUE → 중복을 넣어 보고 거부되는가
 *   · SET NULL → 회원을 지워 보고 컬럼이 NULL이 되고 행은 남는가
 *   · NO ACTION → 회원을 지워 보고 삭제가 거부되고 출석·투표가 남는가
 * 그리고 각 단언 앞에 **부정 대조**(제약이 없던 0000/0001 스키마)를 둬서,
 * 통과가 우연이 아니라 이 마이그레이션 덕분임을 보인다.
 */

const DB_PATH = 'scripts/testing/.board-schema-constraints.db'
const OLD_DB_PATH = 'scripts/testing/.board-schema-constraints-old.db'

const BOARD_CHILD_TABLES = [
  'board_agendas',
  'board_minutes',
  'board_meeting_attendees',
  'board_meeting_date_options',
  'board_meeting_date_votes',
]

function cleanup(path) {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${path}${suffix}`, { force: true })
}

/** 0000·0001만 적용한 "고치기 전" 스키마 — 부정 대조용. */
async function applyPreFixMigrations(client) {
  for (const file of migrationFiles()) {
    if (file.includes('0002_')) break
    await client.executeMultiple(readFileSync(file, 'utf8'))
  }
}

/** 회의 1건 + 이사 1명 + 자식 표 전부 1행씩. */
async function seedBoardFixture(client, { memberId = 'm1', meetingId = 'mt1' } = {}) {
  const now = Date.now()
  await client.executeMultiple(`
    INSERT INTO member_profiles
      (id, display_name, email, created_at, updated_at, artist_role, is_active, is_admin,
       is_suspended, is_member, is_artist, is_director, is_auditor, registration_status,
       profile_completeness_score, engagement_score, verification_status, membership_type)
    VALUES ('${memberId}','이사A','${memberId}@example.com',${now},${now},'owner',1,0,0,1,0,1,0,
            'approved',0,0,'{}','regular');
    INSERT INTO board_meetings (id,title,status,created_by,created_at,updated_at)
      VALUES ('${meetingId}','1차 이사회','completed','${memberId}',${now},${now});
    INSERT INTO board_agendas (id,meeting_id,title,sort_order,status,proposed_by,created_at,updated_at)
      VALUES ('ag1','${meetingId}','안건',0,'resolved','${memberId}',${now},${now});
    INSERT INTO board_minutes (id,meeting_id,content,content_format,author_id,created_at,updated_at)
      VALUES ('mn1','${meetingId}','회의록 본문','markdown','${memberId}',${now},${now});
    INSERT INTO board_meeting_attendees (id,meeting_id,member_id,attended,created_at,updated_at)
      VALUES ('at1','${meetingId}','${memberId}',1,${now},${now});
    INSERT INTO board_meeting_date_options (id,meeting_id,candidate_date)
      VALUES ('op1','${meetingId}','2026-01-01');
    INSERT INTO board_meeting_date_votes (id,option_id,voter_id,is_available,created_at,updated_at)
      VALUES ('vt1','op1','${memberId}',1,${now},${now});
    INSERT INTO board_documents (id,title,category,file_path,uploaded_by,created_at)
      VALUES ('dc1','정관','정관','board-documents/x.pdf','${memberId}',${now});
  `)
}

async function count(client, table) {
  const r = await client.execute(`SELECT count(*) AS n FROM ${table}`)
  return Number(r.rows[0].n)
}

async function onDeleteRule(client, table, column) {
  const r = await client.execute(`PRAGMA foreign_key_list(${JSON.stringify(table)})`)
  const row = r.rows.find(x => String(x.from) === column)
  return row ? String(row.on_delete) : null
}

let db
let oldDb

before(async () => {
  cleanup(DB_PATH)
  cleanup(OLD_DB_PATH)
  db = createClient({ url: `file:${DB_PATH}` })
  await applyMigrations(db)
  oldDb = createClient({ url: `file:${OLD_DB_PATH}` })
  await applyPreFixMigrations(oldDb)
})

after(() => {
  db?.close()
  oldDb?.close()
  cleanup(DB_PATH)
  cleanup(OLD_DB_PATH)
})

// ------------------------------------------------------------------ 전제

test('libsql은 FK를 기본으로 강제한다(=이 테스트의 단언이 의미를 가진다)', async () => {
  const r = await db.execute('PRAGMA foreign_keys')
  assert.equal(Number(r.rows[0].foreign_keys), 1)
})

// ------------------------------------------------------------- B-9 UNIQUE

describe('B-9: board_minutes.meeting_id UNIQUE', () => {
  test('부정 대조 — 0002 이전 스키마는 같은 회의에 회의록 2건을 받아 준다', async () => {
    await seedBoardFixture(oldDb, { memberId: 'old-m', meetingId: 'old-mt' })
    const now = Date.now()
    await oldDb.execute(
      `INSERT INTO board_minutes (id,meeting_id,content,content_format,author_id,created_at,updated_at)
       VALUES ('old-mn2','old-mt','중복 회의록','markdown','old-m',${now},${now})`
    )
    assert.equal(await count(oldDb, 'board_minutes'), 2)
  })

  test('복원 후 — 같은 meeting_id로 두 번째 회의록을 넣으면 UNIQUE로 거부된다', async () => {
    await seedBoardFixture(db)
    const now = Date.now()
    await assert.rejects(
      () =>
        db.execute(
          `INSERT INTO board_minutes (id,meeting_id,content,content_format,author_id,created_at,updated_at)
           VALUES ('mn2','mt1','중복 회의록','markdown','m1',${now},${now})`
        ),
      /UNIQUE constraint failed: board_minutes\.meeting_id/
    )
    assert.equal(await count(db, 'board_minutes'), 1)
  })

  test('다른 회의의 회의록은 계속 들어간다(과잉 제약이 아니다)', async () => {
    const now = Date.now()
    await db.execute(
      `INSERT INTO board_meetings (id,title,status,created_at,updated_at)
       VALUES ('mt2','2차 이사회','completed',${now},${now})`
    )
    await db.execute(
      `INSERT INTO board_minutes (id,meeting_id,content,content_format,created_at,updated_at)
       VALUES ('mn3','mt2','다른 회의록','markdown',${now},${now})`
    )
    assert.equal(await count(db, 'board_minutes'), 2)
    await db.execute(`DELETE FROM board_meetings WHERE id='mt2'`)
  })
})

// --------------------------------------------------------- B-10 ON DELETE

describe('B-10: member_profiles를 가리키는 FK 6개의 ON DELETE', () => {
  test('선언된 규칙이 Postgres 원본과 같다', async () => {
    assert.equal(await onDeleteRule(db, 'board_meetings', 'created_by'), 'SET NULL')
    assert.equal(await onDeleteRule(db, 'board_agendas', 'proposed_by'), 'SET NULL')
    assert.equal(await onDeleteRule(db, 'board_minutes', 'author_id'), 'SET NULL')
    assert.equal(await onDeleteRule(db, 'board_documents', 'uploaded_by'), 'SET NULL')
    assert.equal(await onDeleteRule(db, 'board_meeting_attendees', 'member_id'), 'NO ACTION')
    assert.equal(await onDeleteRule(db, 'board_meeting_date_votes', 'voter_id'), 'NO ACTION')
  })

  test('부정 대조 — 0002 이전 스키마에서는 출석·투표 기록이 회원 삭제에 조용히 딸려 지워진다', async () => {
    // 회원 삭제를 막던 SET NULL 대상 4개가 그때는 NO ACTION이라, 먼저 그 참조부터
    // 손으로 끊어야 삭제가 시작된다 — 그 다음이 이 부정 대조의 본체다.
    await oldDb.executeMultiple(`
      UPDATE board_meetings SET created_by=NULL WHERE created_by='old-m';
      UPDATE board_agendas SET proposed_by=NULL WHERE proposed_by='old-m';
      UPDATE board_minutes SET author_id=NULL WHERE author_id='old-m';
      UPDATE board_documents SET uploaded_by=NULL WHERE uploaded_by='old-m';
    `)
    assert.equal(await count(oldDb, 'board_meeting_attendees'), 1)
    assert.equal(await count(oldDb, 'board_meeting_date_votes'), 1)
    await oldDb.execute(`DELETE FROM member_profiles WHERE id='old-m'`)
    assert.equal(await count(oldDb, 'board_meeting_attendees'), 0, '출석 기록이 cascade로 사라졌다')
    assert.equal(
      await count(oldDb, 'board_meeting_date_votes'),
      0,
      '투표 기록이 cascade로 사라졌다'
    )
  })

  test('복원 후 — 출석 기록이 있으면 회원 삭제 자체가 거부되고 기록은 그대로다', async () => {
    await assert.rejects(
      () => db.execute(`DELETE FROM member_profiles WHERE id='m1'`),
      /FOREIGN KEY constraint failed/
    )
    assert.equal(await count(db, 'board_meeting_attendees'), 1)
    assert.equal(await count(db, 'board_meeting_date_votes'), 1)
    assert.equal(await count(db, 'member_profiles'), 1)
  })

  test('복원 후 — 출석·투표를 정리한 뒤 지우면 작성자 4곳이 NULL이 되고 행은 전부 남는다', async () => {
    await db.executeMultiple(`
      DELETE FROM board_meeting_attendees WHERE member_id='m1';
      DELETE FROM board_meeting_date_votes WHERE voter_id='m1';
    `)
    await db.execute(`DELETE FROM member_profiles WHERE id='m1'`)

    for (const [table, column] of [
      ['board_meetings', 'created_by'],
      ['board_agendas', 'proposed_by'],
      ['board_minutes', 'author_id'],
      ['board_documents', 'uploaded_by'],
    ]) {
      const r = await db.execute(
        `SELECT count(*) AS total, count(${column}) AS filled FROM ${table}`
      )
      assert.equal(Number(r.rows[0].total), 1, `${table} 행이 사라졌다`)
      assert.equal(Number(r.rows[0].filled), 0, `${table}.${column}이 NULL이 되지 않았다`)
    }
  })
})

// --------------------------------------------------- 회의 삭제(원본과 동일)

test('board_meetings 삭제는 원본대로 자식 표를 cascade로 정리한다', async () => {
  const fresh = createClient({ url: ':memory:' })
  try {
    await applyMigrations(fresh)
    await seedBoardFixture(fresh, { memberId: 'cm', meetingId: 'cmt' })
    await fresh.execute(`DELETE FROM board_meetings WHERE id='cmt'`)
    for (const table of BOARD_CHILD_TABLES) {
      assert.equal(await count(fresh, table), 0, `${table}이 cascade로 지워지지 않았다`)
    }
    // 서류함은 회의와 독립이라 남아야 한다.
    assert.equal(await count(fresh, 'board_documents'), 1)
  } finally {
    fresh.close()
  }
})

// ------------------------------------------------- 마이그레이션 자체의 성질

describe('0002 마이그레이션의 성질', () => {
  test('데이터가 든 표를 재작성해도 행 수·내용이 그대로다', async () => {
    const path = 'scripts/testing/.board-schema-rewrite.db'
    cleanup(path)
    const c = createClient({ url: `file:${path}` })
    try {
      await applyPreFixMigrations(c)
      await seedBoardFixture(c, { memberId: 'rw', meetingId: 'rwmt' })

      const tables = [...BOARD_CHILD_TABLES, 'board_meetings', 'board_documents']
      const before = {}
      for (const t of tables) {
        before[t] = (await c.execute(`SELECT * FROM ${t} ORDER BY id`)).rows.map(r => ({ ...r }))
      }

      const file = migrationFiles().find(f => f.includes('0002_'))
      await c.executeMultiple(readFileSync(file, 'utf8'))

      for (const t of tables) {
        const after = (await c.execute(`SELECT * FROM ${t} ORDER BY id`)).rows.map(r => ({ ...r }))
        assert.deepEqual(after, before[t], `${t} 내용이 재작성으로 바뀌었다`)
      }
    } finally {
      c.close()
      cleanup(path)
    }
  })

  test('두 번 돌려도 같은 스키마·같은 행에 수렴한다(idempotent)', async () => {
    const path = 'scripts/testing/.board-schema-idempotent.db'
    cleanup(path)
    const c = createClient({ url: `file:${path}` })
    try {
      await applyPreFixMigrations(c)
      await seedBoardFixture(c, { memberId: 'id1', meetingId: 'idmt' })
      const file = migrationFiles().find(f => f.includes('0002_'))
      const sql = readFileSync(file, 'utf8')

      await c.executeMultiple(sql)
      const schemaOnce = (
        await c.execute(
          "SELECT type,name,sql FROM sqlite_master WHERE tbl_name LIKE 'board_%' ORDER BY type,name"
        )
      ).rows.map(r => `${r.type} ${r.name} ${String(r.sql ?? '').replace(/\s+/g, ' ')}`)
      const minutesOnce = (await c.execute('SELECT * FROM board_minutes ORDER BY id')).rows.map(
        r => ({ ...r })
      )

      await c.executeMultiple(sql)
      const schemaTwice = (
        await c.execute(
          "SELECT type,name,sql FROM sqlite_master WHERE tbl_name LIKE 'board_%' ORDER BY type,name"
        )
      ).rows.map(r => `${r.type} ${r.name} ${String(r.sql ?? '').replace(/\s+/g, ' ')}`)
      const minutesTwice = (await c.execute('SELECT * FROM board_minutes ORDER BY id')).rows.map(
        r => ({ ...r })
      )

      assert.deepEqual(schemaTwice, schemaOnce)
      assert.deepEqual(minutesTwice, minutesOnce)

      // 임시 표가 새지 않았다.
      const leftovers = await c.execute(
        "SELECT name FROM sqlite_master WHERE name LIKE '__new_%' OR name LIKE '__migration_assert%'"
      )
      assert.deepEqual(leftovers.rows, [])
    } finally {
      c.close()
      cleanup(path)
    }
  })

  test('변이 대조 — 행이 하나라도 새면 마이그레이션 안의 단언이 물고 전체가 롤백된다', async () => {
    // 마이그레이션에 심은 `__migration_assert_0002`가 장식이 아님을 보인다.
    // 복사 SELECT에 `WHERE 0`을 끼워 일부러 0행을 옮기게 만든다.
    const c = createClient({ url: ':memory:' })
    try {
      await applyPreFixMigrations(c)
      await seedBoardFixture(c, { memberId: 'mu', meetingId: 'mumt' })
      const file = migrationFiles().find(f => f.includes('0002_'))
      const mutated = readFileSync(file, 'utf8').replace(
        'FROM `board_agendas`;',
        'FROM `board_agendas` WHERE 0;'
      )
      assert.notEqual(mutated, readFileSync(file, 'utf8'), '변이가 적용되지 않았다')

      await assert.rejects(() => c.executeMultiple(mutated), /CHECK constraint failed/)

      // 롤백됐으므로 원래 행이 그대로고 임시 표도 남지 않는다.
      assert.equal(await count(c, 'board_agendas'), 1)
      const leftovers = await c.execute(
        "SELECT name FROM sqlite_master WHERE name LIKE '__new_%' OR name LIKE '__migration_assert%'"
      )
      assert.deepEqual(leftovers.rows, [])
    } finally {
      c.close()
    }
  })

  test('PRAGMA가 먹지 않으면 FK 단언이 물고 전체가 롤백된다', async () => {
    // 이 마이그레이션이 안전한 근거는 `PRAGMA foreign_keys=OFF`가 실제로 먹었다는
    // 사실 하나뿐인데, 운영 Turso에서 그게 참인지는 적용 전에 알 수 없다. 그래서
    // 첫 DROP 전에 FK 상태 자체를 단언한다. PRAGMA를 무력화해(= 안 먹는 상황)
    // 그 단언이 실제로 무는지 확인한다.
    const c = createClient({ url: ':memory:' })
    try {
      await applyPreFixMigrations(c)
      await seedBoardFixture(c, { memberId: 'fk', meetingId: 'fkmt' })
      const file = migrationFiles().find(f => f.includes('0002_'))
      const mutated = readFileSync(file, 'utf8').replace('PRAGMA foreign_keys=OFF;', 'SELECT 1;')
      assert.notEqual(mutated, readFileSync(file, 'utf8'), '변이가 적용되지 않았다')

      await assert.rejects(() => c.executeMultiple(mutated), /CHECK constraint failed/)

      // 조용한 데이터 소실이 원자적 중단으로 바뀐다 — 7개 표 전부 그대로.
      for (const table of [...BOARD_CHILD_TABLES, 'board_meetings', 'board_documents']) {
        assert.equal(await count(c, table), 1, `${table} 행이 사라졌다`)
      }
      const leftovers = await c.execute(
        "SELECT name FROM sqlite_master WHERE name LIKE '__new_%' OR name LIKE '__migration_assert%'"
      )
      assert.deepEqual(leftovers.rows, [])
    } finally {
      c.close()
    }
  })

  test('부정 대조 — FK 단언을 빼면 같은 상황이 에러 없이 커밋되고 5개 표가 빈다', async () => {
    // 위 단언이 "통과하지만 아무것도 안 지키는" 장식이 아님을 보인다. 행 수 단언은
    // 표마다 자기 DROP 직전에 걸려 있어서, 뒤에 오는 `DROP TABLE board_meetings`가
    // 이미 재작성을 마친 앞 표들을 cascade로 비우는 사고를 하나도 잡지 못한다.
    const c = createClient({ url: ':memory:' })
    try {
      await applyPreFixMigrations(c)
      await seedBoardFixture(c, { memberId: 'nofk', meetingId: 'nofkmt' })
      const file = migrationFiles().find(f => f.includes('0002_'))
      const assertLine =
        'INSERT INTO `__migration_assert_0002` (`ok`) SELECT CASE WHEN (SELECT foreign_keys FROM pragma_foreign_keys()) = 0 THEN 1 ELSE 0 END;\n--> statement-breakpoint\n'
      const raw = readFileSync(file, 'utf8')
      assert.ok(raw.includes(assertLine), 'FK 단언이 마이그레이션에서 사라졌다')
      const mutated = raw.replace('PRAGMA foreign_keys=OFF;', 'SELECT 1;').replace(assertLine, '')

      // 에러 없이 커밋된다.
      await c.executeMultiple(mutated)

      assert.equal(await count(c, 'board_meetings'), 1)
      for (const table of BOARD_CHILD_TABLES) {
        assert.equal(await count(c, table), 0, `${table}이 비지 않았다 — 대조가 무의미해졌다`)
      }
    } finally {
      c.close()
    }
  })

  test('이미 열린 트랜잭션 안에서 실행되면 BEGIN이 즉시 막고 아무것도 바뀌지 않는다', async () => {
    // `drizzle-kit migrate`처럼 마이그레이터가 자체 트랜잭션으로 감싸는 경로를
    // 흉내낸다. 트랜잭션 안에서는 `PRAGMA foreign_keys`가 무시되므로 위험해
    // 보이지만, 스크립트의 `BEGIN`이 먼저 실패해 **안전하게** 멈춘다. 이 성질이
    // 사라지면(= 누가 BEGIN/COMMIT을 걷어내면) 이 테스트가 깨져야 한다.
    const c = createClient({ url: ':memory:' })
    try {
      await applyPreFixMigrations(c)
      await seedBoardFixture(c, { memberId: 'tx', meetingId: 'txmt' })
      const file = migrationFiles().find(f => f.includes('0002_'))
      const statements = readFileSync(file, 'utf8')
        .split('--> statement-breakpoint')
        .map(s => s.trim())
        .filter(s => s && !/^(?:--[^\n]*\n?)+$/.test(s))

      await c.execute('BEGIN')
      await assert.rejects(async () => {
        for (const statement of statements) await c.execute(statement)
      }, /cannot start a transaction within a transaction/)
      await c.execute('ROLLBACK')

      for (const table of [...BOARD_CHILD_TABLES, 'board_meetings', 'board_documents']) {
        assert.equal(await count(c, table), 1, `${table} 행이 사라졌다`)
      }
      const leftovers = await c.execute(
        "SELECT name FROM sqlite_master WHERE name LIKE '__new_%' OR name LIKE '__migration_assert%'"
      )
      assert.deepEqual(leftovers.rows, [])
    } finally {
      c.close()
    }
  })

  test('재작성으로 인덱스가 사라지지 않는다', async () => {
    const r = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name LIKE 'board_%' AND sql IS NOT NULL ORDER BY name"
    )
    // 앞의 셋은 0002가 표를 재작성하면서 다시 만들어야 하는 UNIQUE 인덱스다
    // (하나라도 빠지면 재작성이 제약을 잃었다는 뜻이다). 뒤의 셋은 0004가
    // 추가한 성능 인덱스다(최종 리뷰 B-7) — 목록을 정확히 고정해 두면
    // "0002가 무엇을 지웠는가"와 "0004가 무엇을 더했는가"가 둘 다 드러난다.
    assert.deepEqual(
      r.rows.map(x => String(x.name)),
      [
        'board_meeting_attendees_meeting_member_idx',
        'board_meeting_date_votes_option_voter_idx',
        'board_minutes_meeting_id_idx',
        'idx_board_agendas_meeting',
        'idx_board_date_options_meeting',
        'idx_board_documents_category',
      ]
    )
  })

  test('생성물 원문을 그대로 쓰면 안 되는 이유가 여전히 유효하다(FK ON + DROP TABLE = cascade 삭제)', async () => {
    // 0002가 `PRAGMA foreign_keys=OFF`를 스크립트 전체에 걸어 둔 근거를 실증한다.
    // 이 대조가 깨지면(=SQLite 동작이 바뀌면) 그 방어는 더 이상 필요 없다는 뜻이다.
    const c = createClient({ url: ':memory:' })
    try {
      await applyPreFixMigrations(c)
      await seedBoardFixture(c, { memberId: 'hz', meetingId: 'hzmt' })
      assert.equal(await count(c, 'board_agendas'), 1)
      await c.executeMultiple(`
        CREATE TABLE __new_board_meetings (
          id text PRIMARY KEY NOT NULL, title text NOT NULL, meeting_date text, location text,
          status text DEFAULT 'polling' NOT NULL, vote_deadline integer, created_by text,
          created_at integer NOT NULL, updated_at integer NOT NULL,
          FOREIGN KEY (created_by) REFERENCES member_profiles(id) ON DELETE set null
        );
        INSERT INTO __new_board_meetings SELECT id,title,meeting_date,location,status,vote_deadline,created_by,created_at,updated_at FROM board_meetings;
        DROP TABLE board_meetings;
        ALTER TABLE __new_board_meetings RENAME TO board_meetings;
      `)
      assert.equal(await count(c, 'board_meetings'), 1)
      assert.equal(await count(c, 'board_agendas'), 0, 'FK가 켜진 채 DROP해도 자식이 살아남았다')
      assert.equal(await count(c, 'board_meeting_attendees'), 0)
    } finally {
      c.close()
    }
  })
})
