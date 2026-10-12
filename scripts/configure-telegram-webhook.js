'use strict';

const path = require('node:path');
const dotenv = require('dotenv');
const { createTelegramClient, logTelegramError } = require('../telegram-api');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const token = process.env.TELEGRAM_BOT_TOKEN?.trim() || '';
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || '';
const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL?.trim()
  || 'https://roy-proposed-reg-genealogy.trycloudflare.com/api/telegram/webhook';

function safeWebhookInfo(info) {
  return {
    url: info.url || '',
    hasCustomCertificate: Boolean(info.has_custom_certificate),
    pendingUpdateCount: Number(info.pending_update_count || 0),
    lastErrorDate: info.last_error_date || null,
    lastErrorMessage: info.last_error_message || null,
    maxConnections: info.max_connections || null,
    allowedUpdates: info.allowed_updates || [],
  };
}

async function main() {
  if (!token) {
    console.error('Telegram тохиргоо дутуу: .env файлд TELEGRAM_BOT_TOKEN нэмнэ үү.');
    process.exitCode = 1;
    return;
  }

  const telegram = createTelegramClient(token);
  try {
    await telegram.setWebhook(webhookUrl, secret);
    console.log('Telegram webhook бүртгэх хүсэлт амжилттай.');
    const info = await telegram.getWebhookInfo();
    console.log('Webhook-ийн аюулгүй мэдээлэл:');
    console.log(JSON.stringify(safeWebhookInfo(info), null, 2));
    if (info.url !== webhookUrl) {
      console.error('Webhook URL Telegram дээр хүссэн URL-тэй таарахгүй байна.');
      process.exitCode = 1;
    }
  } catch (error) {
    logTelegramError('Webhook тохируулах үед', error);
    process.exitCode = 1;
  }
}

main();
