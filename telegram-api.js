'use strict';

class TelegramApiError extends Error {
  constructor(method, status, description) {
    super(`Telegram API ${method} хүсэлт амжилтгүй.`);
    this.name = 'TelegramApiError';
    this.method = method;
    this.status = status;
    this.description = description || 'Тодорхойгүй алдаа';
  }
}

function createTelegramClient(token) {
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN тохируулагдаагүй байна.');
  }

  async function call(method, payload = {}) {
    let response;

    try {
      response = await fetch(
        `https://api.telegram.org/bot${token}/${method}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        }
      );
    } catch (_error) {
      throw new TelegramApiError(
        method,
        0,
        'Telegram API-тай холбогдож чадсангүй.'
      );
    }

    let data;

    try {
      data = await response.json();
    } catch (_error) {
      throw new TelegramApiError(
        method,
        response.status,
        'Telegram API буруу хариу буцаалаа.'
      );
    }

    if (!response.ok || !data.ok) {
      throw new TelegramApiError(
        method,
        response.status,
        data.description
      );
    }

    return data.result;
  }

  return {
    // Bot token хүчинтэй эсэхийг шалгана
    getMe: () => call('getMe'),

    // Telegram webhook бүртгэнэ
    setWebhook: (url, secretToken = '') =>
      call('setWebhook', {
        url,
        ...(secretToken
          ? { secret_token: secretToken }
          : {}),
        allowed_updates: ['message'],
        drop_pending_updates: false,
      }),

    // Одоогийн webhook мэдээлэл
    getWebhookInfo: () => call('getWebhookInfo'),

    // Telegram руу текст мессеж илгээнэ
    sendMessage: (chatId, text) =>
      call('sendMessage', {
        chat_id: chatId,
        text,
      }),
  };
}

function logTelegramError(context, error) {
  if (error instanceof TelegramApiError) {
    console.error(
      `[Telegram] ${context}: method=${error.method}, ` +
      `status=${error.status}, алдаа=${error.description}`
    );
    return;
  }

  console.error(
    `[Telegram] ${context}: тодорхойгүй алдаа.`
  );
}

module.exports = {
  createTelegramClient,
  logTelegramError,
};