const assert = require('node:assert/strict');
const { executeFinanceQuery } = require('./finance-tools');

const transactions = [
  { date: '2026-10-05', type: 'expense', category: 'Хоол', note: 'Өдрийн хоол', account: 'Хувийн', amount: 18000 },
  { date: '2026-10-04', type: 'expense', category: 'Тээвэр', note: 'Такси', account: 'Хувийн', amount: 12000 },
  { date: '2026-10-03', type: 'expense', category: 'Материал', note: 'Түүхий эд', account: 'Бизнес', amount: 100000 },
  { date: '2026-10-02', type: 'income', category: 'Борлуулалт', note: 'Захиалга', account: 'Бизнес', amount: 240000 },
  { date: '2026-09-15', type: 'expense', category: 'Хоол', note: 'Өдрийн хоол', account: 'Хувийн', amount: 10000 },
];
const ask = (text, history = []) => executeFinanceQuery({ text, transactions, currentDate: '2026-10-05', selectedAccount: 'all', history });

for (const question of ['Миний сүүлийн зарлагуудыг харуул', 'Энэ сарын нийт зарлага хэд вэ?', 'Хоолонд хэдийг зарцуулсан?', 'Би юунд хамгийн их мөнгө үрээд байна?', 'Өнгөрсөн сараас энэ сарын зарлага өссөн үү?', 'Энэ сарын орлого хэд вэ?', '500000 төгрөг хэмнэхийн тулд яах вэ?', 'Бизнесийн энэ сарын ашиг хэд вэ?', 'Санхүүгийн байдлыг минь дүгнэ']) assert.equal(ask(question).handled, true, question);
assert.match(ask('Хоолонд хэдийг зарцуулсан?').reply, /18[,. ]?000/);
assert.match(ask('Бизнесийн энэ сарын ашиг хэд вэ?').reply, /140[,. ]?000/);
assert.match(ask('Өнгөрсөн сард?', [{ role: 'user', text: 'Хоолонд хэдийг зарцуулсан?' }]).reply, /10[,. ]?000/);
assert.match(ask('Хэдэн хувиар өссөн?', [{ role: 'user', text: 'Өнгөрсөн сараас энэ сарын зарлага өссөн үү?' }]).reply, /%/);
console.log('Санхүүгийн deterministic tool асуултууд: OK');
