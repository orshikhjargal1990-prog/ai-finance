'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const dotenv = require('dotenv');
const OpenAI = require('openai');
const { createTelegramClient, logTelegramError } = require('./telegram-api');
const { createFinanceParser } = require('./openai-parser');
const { executeFinanceQuery } = require('./finance-tools');
const { normalizeSpokenAmounts } = require('./speech-normalizer');

dotenv.config({ path: path.join(__dirname, '.env') });
const database = require('./database');

const app = express();
const port = Number.parseInt(process.env.PORT || '8000', 10);
const telegramToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || '';
const openaiApiKey = process.env.OPENAI_API_KEY?.trim() || '';
const openaiModel = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
const siteAccessPassword = process.env.SITE_ACCESS_PASSWORD || '';
const publicDir = __dirname;
const telegram = telegramToken ? createTelegramClient(telegramToken) : null;
const parseWithOpenAI = createFinanceParser(openaiApiKey, openaiModel);
const speechClient = openaiApiKey ? new OpenAI({ apiKey: openaiApiKey }) : null;
const emptyState = () => ({ transactions: [], categories: ['Хоол', 'Материал', 'Тээвэр', 'Борлуулалт', 'Цалин', 'Бусад'], limits: {}, chatHistory: [] });
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const cookieName = 'finance_session';
const loginAttempts = new Map();
const scrypt = (password, salt) => new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, key) => error ? reject(error) : resolve(key)));
async function passwordHash(password) { const salt = crypto.randomBytes(16).toString('hex'); return `${salt}:${(await scrypt(password, salt)).toString('hex')}`; }
async function passwordMatches(password, saved) {
  const [salt, expectedHex] = String(saved || '').split(':');
  if (!salt || !expectedHex || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(expectedHex)) return false;
  const actual = await scrypt(password, salt);
  return crypto.timingSafeEqual(actual, Buffer.from(expectedHex, 'hex'));
}
const dummyPasswordHash = passwordHash('invalid-password-placeholder');
function sessionToken(request) {
  const match = new RegExp(`(?:^|; )${cookieName}=([a-f0-9]{64})(?:;|$)`).exec(request.get('cookie') || '');
  return match?.[1] || '';
}
async function startSession(user, response) {
  const token = crypto.randomBytes(32).toString('hex');
  await database.createSession(hashToken(token), user.id);
  response.cookie(cookieName, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 30 * 86400 * 1000 });
}
function authError(response, error) {
  console.error('[Auth] Өгөгдлийн сангийн алдаа.', { code: error.code });
  return response.status(503).json({ ok: false, error: 'Бүртгэлийн сан түр ажиллахгүй байна.' });
}

async function handleTelegramUpdate(update) {
  const message = update.message;
  if (!message || typeof message.text !== 'string' || message.chat?.id == null) return;

  const isStart = /^\/start(?:@\w+)?(?:\s|$)/i.test(message.text.trim());
  const reply = isStart
    ? 'AI Санхүү ботод тавтай морил 👋'
    : 'Таны мессежийг хүлээн авлаа.';

  try {
    await telegram.sendMessage(message.chat.id, reply);
  } catch (error) {
    logTelegramError('Мессеж илгээх үед', error);
  }
}

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((request, response, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) || request.path === '/api/telegram/webhook') return next();
  const origin = request.get('origin');
  const expected = `${process.env.NODE_ENV === 'production' ? 'https' : request.protocol}://${request.get('host')}`;
  if (origin !== expected) return response.status(403).json({ ok: false, error: 'Хүсэлтийн эх сурвалж зөвшөөрөгдөөгүй.' });
  next();
});

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    server: 'ажиллаж байна',
    telegramConfigured: Boolean(telegramToken),
    openaiConfigured: Boolean(openaiApiKey),
    databaseConfigured: database.enabled(),
  });
});

app.post('/api/auth/signup', async (request, response) => {
  if (!database.enabled()) return response.status(503).json({ ok: false, error: 'Өгөгдлийн сан тохируулагдаагүй байна.' });
  const email = String(request.body?.email || '').trim().toLowerCase();
  const name = String(request.body?.name || '').trim();
  const password = request.body?.password;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !name || name.length > 80 || typeof password !== 'string' || password.length < 12 || password.length > 128) return response.status(400).json({ ok: false, error: 'Нэр, зөв имэйл, 12-оос дээш тэмдэгттэй нууц үг оруулна уу.' });
  try {
    const user = await database.createUser(email, name, await passwordHash(password), emptyState());
    await startSession(user, response);
    return response.status(201).json({ ok: true, user });
  } catch (error) {
    if (error.code === '23505') return response.status(409).json({ ok: false, error: 'Энэ имэйлээр бүртгэл аль хэдийн үүссэн байна.' });
    return authError(response, error);
  }
});

app.post('/api/auth/login', async (request, response) => {
  const email = String(request.body?.email || '').trim().toLowerCase();
  const password = request.body?.password;
  if (!email || typeof password !== 'string') return response.status(400).json({ ok: false, error: 'Имэйл, нууц үгээ оруулна уу.' });
  const bucket = `${request.ip}:${email}`;
  const attempt = loginAttempts.get(bucket);
  if (attempt && attempt.until > Date.now() && attempt.count >= 10) return response.status(429).json({ ok: false, error: 'Олон удаа оролдлоо. 15 минутын дараа дахин оролдоно уу.' });
  try {
    const user = await database.findUserByEmail(email);
    const valid = await passwordMatches(password, user?.password_hash || await dummyPasswordHash);
    if (!valid) {
      loginAttempts.set(bucket, { count: (attempt?.until > Date.now() ? attempt.count : 0) + 1, until: Date.now() + 15 * 60 * 1000 });
      return response.status(401).json({ ok: false, error: 'Имэйл эсвэл нууц үг буруу байна.' });
    }
    loginAttempts.delete(bucket);
    await startSession(user, response);
    return response.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
  } catch (error) { return authError(response, error); }
});

app.get('/api/auth/me', async (request, response) => {
  try {
    const token = sessionToken(request);
    const user = token && await database.getSession(hashToken(token));
    return user ? response.json({ ok: true, user }) : response.status(401).json({ ok: false, error: 'Нэвтрэх шаардлагатай.' });
  } catch (error) { return authError(response, error); }
});

app.post('/api/auth/logout', async (request, response) => {
  try {
    const token = sessionToken(request);
    if (token) await database.deleteSession(hashToken(token));
    response.clearCookie(cookieName, { path: '/', sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    return response.json({ ok: true });
  } catch (error) { return authError(response, error); }
});

app.use('/api', async (request, response, next) => {
  if (request.path === '/telegram/webhook') return next();
  try {
    const token = sessionToken(request);
    request.user = token && await database.getSession(hashToken(token));
    if (!request.user) return response.status(401).json({ ok: false, error: 'Нэвтрэх шаардлагатай.' });
    next();
  } catch (error) { return authError(response, error); }
});

app.get('/api/state', async (request, response) => {
  if (!database.enabled()) return response.status(503).json({ ok: false, error: 'Өгөгдлийн сан тохируулагдаагүй байна.' });
  try {
    const result = await database.getUserState(request.user.id);
    return result ? response.json({ ok: true, ...result }) : response.status(404).json({ ok: false, error: 'Өгөгдөл хараахан үүсээгүй байна.' });
  } catch (error) {
    console.error('[Database] Уншихад алдаа гарлаа.', { code: error.code });
    return response.status(503).json({ ok: false, error: 'Өгөгдлийн сантай холбогдож чадсангүй.' });
  }
});

app.post('/api/state/claim-legacy', async (request, response) => {
  const supplied = Buffer.from(String(request.body?.sitePassword || ''));
  const expected = Buffer.from(siteAccessPassword);
  if (!siteAccessPassword || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return response.status(403).json({ ok: false, error: 'Өмнөх сайтын нууц үг буруу байна.' });
  try {
    const current = await database.getUserState(request.user.id);
    if (current?.version !== 1) return response.status(409).json({ ok: false, error: 'Энэ бүртгэлд мэдээлэл хадгалагдсан байна.' });
    const result = await database.claimLegacyState(request.user.id);
    return result ? response.json({ ok: true, ...result }) : response.status(409).json({ ok: false, error: 'Өмнөх мэдээллийг аль хэдийн шилжүүлсэн эсвэл олдсонгүй.' });
  } catch (error) { return authError(response, error); }
});

app.put('/api/state', async (request, response) => {
  if (!database.enabled()) return response.status(503).json({ ok: false, error: 'Өгөгдлийн сан тохируулагдаагүй байна.' });
  const state = database.cleanState(request.body?.state);
  const version = Number(request.body?.version);
  if (!state || !Number.isSafeInteger(version) || version < 1) return response.status(400).json({ ok: false, error: 'Өгөгдлийн бүтэц буруу байна.' });
  try {
    const result = await database.updateUserState(request.user.id, state, version);
    return result ? response.json({ ok: true, ...result }) : response.status(409).json({ ok: false, error: 'Өөр төхөөрөмж дээр мэдээлэл өөрчлөгдсөн байна. Хуудсаа дахин ачаална уу.' });
  } catch (error) {
    console.error('[Database] Хадгалахад алдаа гарлаа.', { code: error.code });
    return response.status(503).json({ ok: false, error: 'Өгөгдлийн сантай холбогдож чадсангүй.' });
  }
});

app.post('/api/ai/transcribe', express.raw({ type: ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-m4a'], limit: '15mb' }), async (request, response) => {
  if (!speechClient) return response.status(503).json({ ok: false, error: 'OpenAI тохиргоо дутуу байна.' });
  if (!Buffer.isBuffer(request.body) || !request.body.length) return response.status(400).json({ ok: false, error: 'Войс бичлэг олдсонгүй.' });
  const mediaType = request.get('content-type')?.split(';')[0].toLowerCase();
  const extension = { 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-m4a': 'm4a' }[mediaType];
  if (!extension) return response.status(415).json({ ok: false, error: 'Энэ аудио формат дэмжигдэхгүй байна.' });
  try {
    const file = await OpenAI.toFile(request.body, `voice.${extension}`, { type: mediaType });
    const result = await speechClient.audio.transcriptions.create({ file, model: 'gpt-4o-mini-transcribe', prompt: 'This audio may be in Mongolian. Transcribe Mongolian speech in Cyrillic script. Keep monetary amounts and finance terms accurate.' });
    const text = normalizeSpokenAmounts(String(result.text || '').trim());
    if (!text) return response.status(422).json({ ok: false, error: 'Яриа танигдсангүй. Дахин хэлнэ үү.' });
    return response.json({ ok: true, text });
  } catch (error) {
    console.error('[OpenAI] Войс хөрвүүлэх хүсэлт амжилтгүй.', { status: error?.status, code: error?.code, type: error?.type, param: error?.param });
    return response.status(error?.status === 429 ? 503 : 502).json({ ok: false, error: error?.status === 429 ? 'OpenAI API credit хүрэлцэхгүй байна.' : 'Войсыг текст болгоход алдаа гарлаа.' });
  }
});

app.post('/api/ai/parse', async (request, response) => {
  if (!parseWithOpenAI) {
    return response.status(503).json({
      ok: false,
      error: 'OpenAI тохиргоо дутуу байна. .env файлд OPENAI_API_KEY тохируулна уу.',
    });
  }

  const text = typeof request.body?.text === 'string' ? request.body.text.trim() : '';
  const categories = Array.isArray(request.body?.categories)
    ? request.body.categories.filter((item) => typeof item === 'string' && item.trim()).slice(0, 50)
    : [];
  const defaultAccount = request.body?.defaultAccount === 'Бизнес' ? 'Бизнес' : 'Хувийн';
  const selectedAccount = ['Хувийн', 'Бизнес', 'all'].includes(request.body?.selectedAccount) ? request.body.selectedAccount : 'all';
  const history = Array.isArray(request.body?.history)
    ? request.body.history.slice(-12).map((item) => ({
        role: item?.role === 'bot' ? 'assistant' : 'user',
        text: typeof item?.text === 'string' ? item.text.trim().slice(0, 1000) : '',
      })).filter((item) => item.text)
    : [];
  const transactionContext = Array.isArray(request.body?.transactions)
    ? request.body.transactions.slice(0, 100).map((item) => ({
        date: typeof item?.date === 'string' ? item.date.slice(0, 10) : '',
        type: item?.type === 'income' ? 'income' : 'expense',
        category: typeof item?.category === 'string' ? item.category.slice(0, 50) : 'Бусад',
        note: typeof item?.note === 'string' ? item.note.slice(0, 120) : '',
        account: item?.account === 'Бизнес' ? 'Бизнес' : 'Хувийн',
        amount: Math.max(0, Math.round(Number(item?.amount) || 0)),
      })).filter((item) => item.amount > 0)
    : [];
  const currentDate = /^20\d{2}-\d{2}-\d{2}$/.test(request.body?.currentDate || '')
    ? request.body.currentDate
    : new Date().toISOString().slice(0, 10);

  if (!text || text.length > 2000) {
    return response.status(400).json({ ok: false, error: 'Мессеж 1–2000 тэмдэгт байх ёстой.' });
  }

  try {
    const toolResult = executeFinanceQuery({ text, transactions: transactionContext, currentDate, selectedAccount, history });
    if (toolResult.handled) return response.json({ ok: true, source: 'finance-tools', mode: 'conversation', reply: toolResult.reply, transactions: [], data: toolResult.data });
    const result = await parseWithOpenAI({ text, categories, defaultAccount, currentDate, history, transactionContext });
    return response.json({
      ok: true,
      source: 'openai',
      mode: result.mode,
      reply: result.reply,
      transactions: result.transactions,
    });
  } catch (error) {
    const noCredit = error?.status === 429 && ['credit_balance_exhausted', 'insufficient_quota'].includes(error?.code || error?.type);
    console.error(noCredit
      ? '[OpenAI] API credit хүрэлцэхгүй байна. API key болон хэрэглэгчийн мессежийг log-д оруулаагүй.'
      : '[OpenAI] Мессеж задлах хүсэлт амжилтгүй. API key болон хэрэглэгчийн мессежийг log-д оруулаагүй.');
    return response.status(noCredit ? 503 : 502).json({
      ok: false,
      error: noCredit ? 'OpenAI API credit хүрэлцэхгүй байна.' : 'OpenAI мессежийг задлах үед алдаа гарлаа.',
    });
  }
});

app.post('/api/telegram/webhook', (request, response) => {
  if (!telegramToken) {
    return response.status(503).json({
      ok: false,
      error: 'Telegram тохиргоо дутуу байна. .env файлд TELEGRAM_BOT_TOKEN тохируулна уу.',
    });
  }

  if (webhookSecret) {
    const receivedSecret = request.get('x-telegram-bot-api-secret-token') || '';
    if (receivedSecret !== webhookSecret) {
      return response.status(401).json({ ok: false, error: 'Webhook хүсэлтийн баталгаажуулалт амжилтгүй.' });
    }
  }

  const update = request.body;
  if (!update || typeof update !== 'object' || !Number.isInteger(update.update_id)) {
    return response.status(400).json({ ok: false, error: 'Telegram update-ийн бүтэц буруу байна.' });
  }

  const updateType = Object.keys(update).find((key) => key !== 'update_id') || 'unknown';
  console.log(`[Telegram] Update хүлээн авлаа: update_id=${update.update_id}, төрөл=${updateType}`);
  response.status(200).json({ ok: true });
  setImmediate(() => void handleTelegramUpdate(update));
});

const publicFiles = new Set(['/', '/index.html', '/app.js', '/landing.js', '/styles.css', '/landing.css', '/overrides.css', '/assets/landing-voice-stock.jpg', '/assets/landing-reports-stock.jpg', '/assets/landing-business-stock.jpg']);
app.use((request, response, next) => {
  if (!publicFiles.has(request.path)) return response.status(404).send('Олдсонгүй.');
  return next();
});
app.use(express.static(publicDir, {
  extensions: ['html'],
  index: 'index.html',
  dotfiles: 'deny',
}));

app.use('/api', (_request, response) => {
  response.status(404).json({ ok: false, error: 'API endpoint олдсонгүй.' });
});

app.use((error, _request, response, _next) => {
  if (error?.type === 'entity.too.large') {
    return response.status(413).json({ ok: false, error: 'Войс бичлэг 15 MB-аас бага байх ёстой.' });
  }
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return response.status(400).json({ ok: false, error: 'JSON хүсэлтийн бүтэц буруу байна.' });
  }
  console.error('[Server] Дотоод алдаа гарлаа.');
  return response.status(500).json({ ok: false, error: 'Серверийн дотоод алдаа гарлаа.' });
});

app.listen(port, async () => {
  console.log(
    `AI Санхүү сервер http://localhost:${port} дээр ажиллаж байна.`
  );

  if (openaiApiKey) {
    console.log(`OpenAI parser тохируулагдсан: model=${openaiModel}. API key-г log-д харуулахгүй.`);
  } else {
    console.warn('OpenAI тохиргоо дутуу: .env файлд OPENAI_API_KEY нэмнэ үү. Веб чат дүрмийн parser ашиглана.');
  }

  if (!telegramToken) {
    console.warn(
      'Telegram тохиргоо дутуу: .env файлд TELEGRAM_BOT_TOKEN нэмнэ үү.'
    );
    return;
  }

  console.log(
    'Telegram token .env файлаас уншигдлаа.'
  );

  try {
    const bot = await telegram.getMe();

    console.log(
      '✅ Telegram Bot API холболт амжилттай.'
    );

    console.log(
      `Bot username: @${bot.username}`
    );

    console.log(
      `Bot ID: ${bot.id}`
    );
  } catch (error) {
    logTelegramError(
      'Bot token шалгах үед',
      error
    );
  }
});
