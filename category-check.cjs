const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const saved = new Map();
const elements = {
  modal: { classList: { add() {}, remove() {} }, innerHTML: '' },
  'new-category': { value: 'Эрүүл мэнд' },
};
const context = vm.createContext({
  localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
  document: { getElementById: id => elements[id], addEventListener() {} },
  Intl,
  console,
  setTimeout() {},
});
vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
vm.runInContext('renderPage = () => {}; toast = () => {}; closeModal = () => {}', context);
vm.runInContext('addCategory()', context);
assert.ok(JSON.parse(saved.get('ai-finance-categories')).includes('Эрүүл мэнд'));
vm.runInContext('addCategory()', context);
assert.equal(JSON.parse(saved.get('ai-finance-categories')).filter(x => x === 'Эрүүл мэнд').length, 1);
vm.runInContext('openCategoryDelete(categories.indexOf("Хоол"))', context);
assert.match(elements.modal.innerHTML, /1 гүйлгээ/);
assert.match(elements.modal.innerHTML, /18,000₮/);
vm.runInContext('confirmCategoryDelete(categories.indexOf("Хоол"))', context);
assert.ok(!JSON.parse(saved.get('ai-finance-categories')).includes('Хоол'));
assert.ok(!JSON.parse(saved.get('ai-finance-tx')).some(x => x.category === 'Хоол'));
vm.runInContext('setDashboardAccount = value => { dashboardAccount = value }', context);
assert.equal(vm.runInContext("tx.filter(x=>x.account==='Хувийн').reduce((sum,x)=>sum+x.amount,0)", context),1862000);
assert.equal(vm.runInContext("tx.filter(x=>x.account==='Бизнес').reduce((sum,x)=>sum+x.amount,0)", context),340000);
assert.equal(vm.runInContext("limitSpent('Материал')", context),100000);
assert.equal(vm.runInContext("Object.assign(categoryLimits,{Материал:150000}); categoryLimits.Материал-limitSpent('Материал')", context),50000);
console.log('Ангилал нэмэх, давхардал, анхааруулга, устгал: OK');
