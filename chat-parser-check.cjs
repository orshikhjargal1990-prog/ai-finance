const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const store = new Map();
const context = vm.createContext({
  localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
  document: { addEventListener() {} },
  Intl,
  Date,
  console,
  setTimeout() {},
});

vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
const result = vm.runInContext("parseFinanceText('Хоол 18 мянга, материал 100 мянга, захиалгын урьдчилгаа 240 мянга орсон.', 'Хувийн')", context);
const chatMarkup = vm.runInContext('chatPage()', context);
assert.match(chatMarkup, /Санхүүгээ асууж, бүртгүүл/);
assert.match(chatMarkup, /Энэ сарын зарлага/);
assert.match(chatMarkup, /Нэгдсэн/);
assert.match(chatMarkup, /id="chat-text"/);
assert.equal(result.length, 3);
assert.equal(JSON.stringify(result.map(x => x.amount)), JSON.stringify([18000, 100000, 240000]));
assert.equal(JSON.stringify(result.map(x => x.type)), JSON.stringify(['expense', 'expense', 'income']));
assert.equal(JSON.stringify(result.map(x => x.category)), JSON.stringify(['Хоол', 'Материал', 'Борлуулалт']));
assert.equal(JSON.stringify(result.map(x => x.account)), JSON.stringify(['Хувийн', 'Бизнес', 'Бизнес']));
console.log('Веб чат олон гүйлгээ, дүн, төрөл, ангилал, бүртгэл: OK');
