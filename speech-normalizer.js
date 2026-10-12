'use strict';

const values = {
  нэг: 1, нэгэн: 1, хоёр: 2, хоёрон: 2, гурван: 3, гурав: 3,
  дөрвөн: 4, дөрөв: 4, таван: 5, тав: 5, зургаан: 6, зургаа: 6,
  долоон: 7, долоо: 7, найман: 8, найм: 8, есөн: 9, ес: 9,
  арван: 10, арав: 10, хорин: 20, хорь: 20, гучин: 30, гуч: 30,
  дөчин: 40, дөч: 40, тавин: 50, тавь: 50, жаран: 60, жар: 60,
  далан: 70, дал: 70, наян: 80, ная: 80, ерэн: 90, ер: 90,
};
const word = Object.keys(values).sort((a, b) => b.length - a.length).join('|');
const spokenAmount = new RegExp(`(?<![\\p{L}])((?:(?:${word})\\s+){1,4})(мянга(?:н)?|сая)(?:\\s+төгрөг)?(?![\\p{L}])`, 'giu');

function normalizeSpokenAmounts(text) {
  return String(text).replace(spokenAmount, (match, phrase, scale) => {
    const parts = phrase.trim().toLocaleLowerCase('mn-MN').split(/\s+/);
    const number = parts.reduce((sum, part) => sum + (values[part] || 0), 0);
    if (!number || number > 999) return match;
    const amount = number * (scale.toLocaleLowerCase('mn-MN').startsWith('сая') ? 1000000 : 1000);
    return `${new Intl.NumberFormat('en-US').format(amount)}₮`;
  }).replace(/(\d+(?:[.,]\d+)?)\s*(мянга(?:н)?|сая)(?:\s+төгрөг)?/giu, (match, raw, scale) => {
    const number = Number(raw.replace(',', '.'));
    if (!Number.isFinite(number)) return match;
    const amount = number * (scale.toLocaleLowerCase('mn-MN').startsWith('сая') ? 1000000 : 1000);
    return `${new Intl.NumberFormat('en-US').format(amount)}₮`;
  });
}

module.exports = { normalizeSpokenAmounts };
