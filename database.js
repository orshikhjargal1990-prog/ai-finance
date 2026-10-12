'use strict';

const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL?.trim() || '';
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 }) : null;
if (pool) pool.on('error', error => console.error('[Database] Idle connection error.', { code: error.code }));
let schemaPromise;

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
