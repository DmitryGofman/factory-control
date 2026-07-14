import { Pool } from "pg";

// ה-Pool נשמר על globalThis כדי לשרוד hot-reload בפיתוח ולהתחלק בין
// הפעלות של אותה אינסטנציה ב-serverless.
const g = globalThis;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS requests (
  id SERIAL PRIMARY KEY,
  serial INTEGER UNIQUE NOT NULL,
  project TEXT NOT NULL DEFAULT '',
  project_alias TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  quantity TEXT NOT NULL DEFAULT '',
  requester TEXT NOT NULL DEFAULT '',
  approver TEXT NOT NULL DEFAULT '',
  approval_date TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '',
  system_name TEXT NOT NULL DEFAULT '',
  external_id TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'רגיל',
  status TEXT NOT NULL DEFAULT 'מעוכבת',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS history (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id),
  ts TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  field TEXT NOT NULL DEFAULT '',
  old_value TEXT NOT NULL DEFAULT '',
  new_value TEXT NOT NULL DEFAULT ''
);
`;

function getPool() {
  if (!g._fcPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL לא מוגדר");
    g._fcPool = new Pool({
      connectionString: url,
      max: 3,
      ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
    });
  }
  return g._fcPool;
}

export async function db() {
  if (!g._fcSchemaReady) g._fcSchemaReady = getPool().query(SCHEMA);
  await g._fcSchemaReady;
  return getPool();
}

export { SCHEMA };
