import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'

import * as schema from './schema'

const url = process.env.TURSO_DATABASE_URL ?? 'file:local.db'
const authToken = process.env.TURSO_AUTH_TOKEN

if (!process.env.TURSO_DATABASE_URL && process.env.NODE_ENV === 'production') {
  throw new Error('TURSO_DATABASE_URL is required in production')
}

export const rawClient = createClient(authToken ? { url, authToken } : { url })

export const db = drizzle(rawClient, { schema })
