'use strict';

const money = (n) => `${new Intl.NumberFormat('mn-MN').format(Math.round(n))}₮`;
const norm = (s) => String(s || '').toLocaleLowerCase('mn-MN').replace(/[?,.!]/g, ' ').replace(/\s+/g, ' ').trim();
const sum = (rows, type) => rows.filter((x) => !type || x.type === type).reduce((n, x) => n + x.amount, 0);

function monthRange(date, offset = 0) {
  const start = new Date(`${date}T00:00:00+08:00`); start.setDate(1); start.setMonth(start.getMonth() + offset);
  const end = new Date(start); end.setMonth(end.getMonth() + 1);
  const iso = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ulaanbaatar' });
  return { start: iso(start), end: iso(end) };
}
const inRange = (rows, range) => rows.filter((x) => x.date >= range.start && x.date < range.end);
function expenseGroups(rows) {
  const grouped = {};
  rows.filter((x) => x.type === 'expense').forEach((x) => { grouped[x.category] = (grouped[x.category] || 0) + x.amount; });
  return Object.entries(grouped).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
}
function accountScope(rows, query, selected) {
  if (/business|biznes|бизнес/.test(query)) return rows.filter((x) => x.account === 'Бизнес');
  if (/хувийн|huviin|personal/.test(query)) return rows.filter((x) => x.account === 'Хувийн');
  return selected === 'all' ? rows : rows.filter((x) => x.account === selected);
}

function executeFinanceQuery({ text, transactions, currentDate, selectedAccount = 'all', history = [] }) {
  const q = norm(text), prior = norm(history.slice(-4).map((x) => x.text).join(' '));
  const rows = accountScope(transactions, q, selectedAccount);
  const current = inRange(rows, monthRange(currentDate)), previous = inRange(rows, monthRange(currentDate, -1));
  const noData = (label) => ({ handled: true, reply: `${label} бүртгэгдсэн мэдээлэл олдсонгүй.`, data: { count: 0 } });

  if (/өртэй|өр хэд|авлага|надаас авах|төлөх төлбөр|дараагийн төлбөр/.test(q)) return { handled: true, reply: 'Өр, авлагын тусгай мэдээлэл одоогийн өгөгдлийн бүтцэд бүртгэгдээгүй байна.', data: { supported: false } };
  if (/сүүлийн (зарлага|гүйлгээ)|зарлагуудыг харуул|recent/.test(q)) {
    const type = /зарлага/.test(q) ? 'expense' : null;
    const found = [...rows].filter((x) => !type || x.type === type).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    if (!found.length) return noData('Сонгосон хүрээнд');
    return { handled: true, reply: `Сүүлийн ${found.length} ${type ? 'зарлага' : 'гүйлгээ'}:\n${found.map((x) => `• ${x.date} — ${x.note} · ${x.category} — **${money(x.amount)}**`).join('\n')}`, data: { rows: found } };
  }

  const isFood = /хоол|hool/.test(q) || (/өнгөрсөн сард/.test(q) && /хоол|hool/.test(prior));
  const isTaxi = /такси|taxi/.test(q) || (/өнгөрсөн сард/.test(q) && /такси|taxi/.test(prior));
  if (isFood || isTaxi) {
    const last = /өнгөрсөн сар|ungursun sar/.test(q), source = last ? previous : current, keyword = isFood ? 'хоол' : 'такси';
    const found = source.filter((x) => x.type === 'expense' && (norm(x.category).includes(keyword) || norm(x.note).includes(keyword)));
    if (!found.length) return noData(last ? 'Өнгөрсөн сард' : 'Энэ сард');
    return { handled: true, reply: `${last ? 'Өнгөрсөн сард' : 'Энэ сард'} ${isFood ? 'хоолонд' : 'таксинд'} **${money(sum(found, 'expense'))}** зарцуулсан байна. (${found.length} гүйлгээ)`, data: { total: sum(found, 'expense'), count: found.length } };
  }

  if (/хамгийн их|юунд их|yuund ih|юунд.*үр|зарлагын хэв маяг/.test(q)) {
    const groups = expenseGroups(current), total = sum(current, 'expense');
    if (!groups.length) return noData('Энэ сард');
    return { handled: true, reply: `Энэ сарын хамгийн өндөр зарлагууд:\n${groups.slice(0, 3).map((x) => `• ${x.name} — **${money(x.amount)}** (${Math.round(x.amount / total * 100)}%)`).join('\n')}`, data: { total, categories: groups } };
  }

  if (/өнгөрсөн сараас|харьцуул|өссөн үү|heden huviar|хэдэн хувиар/.test(q) || (/өнгөрсөн сард/.test(q) && /зарлага|орлого/.test(prior))) {
    const type = /орлого/.test(q + ' ' + prior) ? 'income' : 'expense', now = sum(current, type), before = sum(previous, type);
    if (!current.length && !previous.length) return noData('Харьцуулах хоёр сард');
    const change = before ? ((now - before) / before) * 100 : null, label = type === 'income' ? 'орлого' : 'зарлага';
    return { handled: true, reply: `Энэ сарын ${label}: **${money(now)}**\nӨнгөрсөн сарын ${label}: **${money(before)}**\n${change == null ? 'Өмнөх сарын суурь дүн байхгүй тул хувийн өөрчлөлт тооцох боломжгүй.' : `${Math.abs(change).toFixed(1)}%-иар ${change >= 0 ? 'өссөн' : 'буурсан'}.`}`, data: { current: now, previous: before, percentageChange: change } };
  }

  if (/500 ?000|500к|500k|хэмнэх|hemneh/.test(q)) {
    const match = q.match(/(\d[\d ]*)\s*(?:₮|төгрөг|к|k)?/); let target = match ? Number(match[1].replace(/ /g, '')) : 500000;
    if (/[кk]/.test(q) && target < 10000) target *= 1000;
    const groups = expenseGroups(current); if (!groups.length) return noData('Энэ сард');
    let left = target; const cuts = [];
    for (const x of groups) { const amount = Math.min(Math.round(x.amount * .3), left); if (amount) cuts.push({ name: x.name, amount }); left -= amount; if (left <= 0) break; }
    const possible = target - Math.max(left, 0);
    return { handled: true, reply: `${money(target)} хэмнэх зорилгоос одоогийн зарлагад тулгуурлан **${money(possible)}** хүртэл бууруулах боломж харагдаж байна.\n${cuts.map((x) => `• ${x.name}-аас ${money(x.amount)}`).join('\n')}${possible < target ? `\nҮлдсэн ${money(target - possible)}-д нэмэлт орлого эсвэл урт хугацаа хэрэгтэй.` : ''}`, data: { target, possible, cuts } };
  }

  if (/ашиг|profit/.test(q) && /business|biznes|бизнес/.test(q)) {
    const business = inRange(transactions.filter((x) => x.account === 'Бизнес'), monthRange(currentDate)); if (!business.length) return noData('Бизнесийн энэ сард');
    const income = sum(business, 'income'), expense = sum(business, 'expense');
    return { handled: true, reply: `Бизнесийн энэ сарын орлого **${money(income)}**, зарлага **${money(expense)}**, зөрүү буюу энгийн ашиг **${money(income - expense)}** байна.`, data: { income, expense, profit: income - expense } };
  }
  if (/энэ сарын.*орлого|орлого.*энэ сар|heden olson|хэд олсон/.test(q)) return current.some((x) => x.type === 'income') ? { handled: true, reply: `Энэ сарын нийт орлого **${money(sum(current, 'income'))}** байна.`, data: { income: sum(current, 'income') } } : noData('Энэ сард');
  if (/энэ сарын.*зарлага|зарлага.*энэ сар|энэ сард хэд.*гар|hed garsan/.test(q)) return current.some((x) => x.type === 'expense') ? { handled: true, reply: `Энэ сарын нийт зарлага **${money(sum(current, 'expense'))}** байна.`, data: { expense: sum(current, 'expense') } } : noData('Энэ сард');
  if (/үлдэгдэл|зөрүү|balance/.test(q)) return rows.length ? { handled: true, reply: `Бүртгэгдсэн орлого **${money(sum(rows, 'income'))}**, зарлага **${money(sum(rows, 'expense'))}**, тооцоолсон зөрүү **${money(sum(rows, 'income') - sum(rows, 'expense'))}** байна.`, data: { income: sum(rows, 'income'), expense: sum(rows, 'expense') } } : noData('Сонгосон хүрээнд');
  if (/дүгнэ|тайлан|мөнгө хүрэхгүй|санхүүгийн байдал/.test(q)) {
    if (!current.length) return noData('Энэ сард'); const income = sum(current, 'income'), expense = sum(current, 'expense'), groups = expenseGroups(current);
    return { handled: true, reply: `Энэ сарын орлого **${money(income)}**, зарлага **${money(expense)}**, зөрүү **${money(income - expense)}** байна.${groups[0] ? ` Хамгийн өндөр зардал ${groups[0].name} — ${money(groups[0].amount)}.` : ''}`, data: { income, expense, balance: income - expense, categories: groups } };
  }
  return { handled: false };
}
module.exports = { executeFinanceQuery };
