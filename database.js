'use strict';

const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL?.trim() || '';
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 }) : null;
if (pool) pool.on('error', error => console.error('[Database] Idle connection error.', { code: error.code }));
let schemaPromise;
let userSchemaPromise;

function enabled() { return Boolean(pool); }

function schema() {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  if (!schemaPromise) schemaPromise = pool.query(`
    CREATE TABLE IF NOT EXISTS finance_state (
      id smallint PRIMARY KEY CHECK (id = 1),
      state jsonb NOT NULL,
      version bigint NOT NULL DEFAULT 1,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `).catch(error => { schemaPromise = null; throw error; });
  return schemaPromise;
}

function userSchema() {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  if (!userSchemaPromise) userSchemaPromise = (async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS finance_users (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      email text NOT NULL UNIQUE,
      name text NOT NULL,
      password_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS finance_user_state (
      user_id bigint PRIMARY KEY REFERENCES finance_users(id) ON DELETE CASCADE,
      state jsonb NOT NULL,
      version bigint NOT NULL DEFAULT 1,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS finance_sessions (
      token_hash text PRIMARY KEY,
      user_id bigint NOT NULL REFERENCES finance_users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS finance_legacy_claim (
      id smallint PRIMARY KEY CHECK (id = 1),
      user_id bigint NOT NULL REFERENCES finance_users(id)
    )`);
  })().catch(error => { userSchemaPromise = null; throw error; });
  return userSchemaPromise;
}

function cleanState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  if (!Array.isArray(input.transactions) || input.transactions.length > 5000) return null;
  if (!Array.isArray(input.categories) || input.categories.length > 100) return null;
  if (!input.limits || typeof input.limits !== 'object' || Array.isArray(input.limits)) return null;
  if (!Array.isArray(input.chatHistory) || input.chatHistory.length > 50) return null;
  const transactions = input.transactions.map(item => ({
    id: Number(item?.id), date: String(item?.date || '').slice(0, 10),
    type: item?.type === 'income' ? 'income' : 'expense',
    category: String(item?.category || '').slice(0, 50), note: String(item?.note || '').slice(0, 120),
    account: item?.account === 'Бизнес' ? 'Бизнес' : 'Хувийн',
    amount: Math.round(Number(item?.amount)), source: String(item?.source || '').slice(0, 40),
  }));
  if (transactions.some(item => !Number.isSafeInteger(item.id) || !/^20\d{2}-\d{2}-\d{2}$/.test(item.date) || !Number.isSafeInteger(item.amount) || item.amount <= 0 || !item.category)) return null;
  const categories = input.categories.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim().slice(0, 50));
  const limits = {};
  for (const [name, amount] of Object.entries(input.limits)) {
    if (Object.keys(limits).length >= 100) return null;
    const value = Math.round(Number(amount));
    if (name.length <= 50 && Number.isSafeInteger(value) && value > 0) limits[name] = value;
  }
  const chatHistory = input.chatHistory.map(item => ({
    role: item?.role === 'user' ? 'user' : 'bot',
    text: String(item?.text || '').slice(0, 4000),
    time: String(item?.time || '').slice(0, 30),
  }));
  return { transactions, categories, limits, chatHistory };
}

async function getState() {
  await schema();
  const result = await pool.query('SELECT state, version::text FROM finance_state WHERE id = 1');
  return result.rows[0] ? { state: result.rows[0].state, version: Number(result.rows[0].version) } : null;
}

async function createState(state) {
  await schema();
  const result = await pool.query('INSERT INTO finance_state (id, state) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING RETURNING version::text', [JSON.stringify(state)]);
  return result.rows[0] ? { version: Number(result.rows[0].version) } : null;
}

async function updateState(state, version) {
  await schema();
  const result = await pool.query('UPDATE finance_state SET state = $1::jsonb, version = version + 1, updated_at = now() WHERE id = 1 AND version = $2 RETURNING version::text', [JSON.stringify(state), version]);
  return result.rows[0] ? { version: Number(result.rows[0].version) } : null;
}

module.exports = { enabled, cleanState, getState, createState, updateState };

async function createUser(email, name, passwordHash, initialState) {
  await userSchema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('INSERT INTO finance_users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id::text, email, name', [email, name, passwordHash]);
    const user = result.rows[0];
    await client.query('INSERT INTO finance_user_state (user_id, state) VALUES ($1, $2::jsonb)', [user.id, JSON.stringify(initialState)]);
    await client.query('COMMIT');
    return user;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function findUserByEmail(email) {
  await userSchema();
  const result = await pool.query('SELECT id::text, email, name, password_hash FROM finance_users WHERE email = $1', [email]);
  return result.rows[0] || null;
}

async function createSession(tokenHash, userId) {
  await userSchema();
  await pool.query("INSERT INTO finance_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '30 days')", [tokenHash, userId]);
}

async function getSession(tokenHash) {
  await userSchema();
  const result = await pool.query('SELECT u.id::text, u.email, u.name FROM finance_sessions s JOIN finance_users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()', [tokenHash]);
  return result.rows[0] || null;
}

async function deleteSession(tokenHash) {
  await userSchema();
  await pool.query('DELETE FROM finance_sessions WHERE token_hash = $1', [tokenHash]);
}

async function getUserState(userId) {
  await userSchema();
  const result = await pool.query('SELECT state, version::text FROM finance_user_state WHERE user_id = $1', [userId]);
  return result.rows[0] ? { state: result.rows[0].state, version: Number(result.rows[0].version) } : null;
}

async function updateUserState(userId, state, version) {
  await userSchema();
  const result = await pool.query('UPDATE finance_user_state SET state = $1::jsonb, version = version + 1, updated_at = now() WHERE user_id = $2 AND version = $3 RETURNING version::text', [JSON.stringify(state), userId, version]);
  return result.rows[0] ? { version: Number(result.rows[0].version) } : null;
}

async function claimLegacyState(userId) {
  await userSchema();
  await schema();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const claim = await client.query('INSERT INTO finance_legacy_claim (id, user_id) VALUES (1, $1) ON CONFLICT DO NOTHING RETURNING id', [userId]);
    if (!claim.rowCount) { await client.query('ROLLBACK'); return null; }
    const legacy = await client.query('SELECT state FROM finance_state WHERE id = 1');
    if (!legacy.rowCount) { await client.query('ROLLBACK'); return null; }
    const updated = await client.query('UPDATE finance_user_state SET state = $1::jsonb, version = version + 1, updated_at = now() WHERE user_id = $2 AND version = 1 RETURNING version::text', [JSON.stringify(legacy.rows[0].state), userId]);
    if (!updated.rowCount) { await client.query('ROLLBACK'); return null; }
    await client.query('COMMIT');
    return { state: legacy.rows[0].state, version: Number(updated.rows[0].version) };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

Object.assign(module.exports, { createUser, findUserByEmail, createSession, getSession, deleteSession, getUserState, updateUserState, claimLegacyState });
