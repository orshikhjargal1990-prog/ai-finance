'use strict';

const OpenAI = require('openai');

function buildFinanceContext(transactions) {
  const totals = { income: 0, expense: 0 };
  const byCategory = {};
  const byAccount = {};

  for (const item of transactions) {
    totals[item.type] += item.amount;
    const category = byCategory[item.category] ||= { income: 0, expense: 0, count: 0 };
    category[item.type] += item.amount;
    category.count += 1;
    const account = byAccount[item.account] ||= { income: 0, expense: 0 };
    account[item.type] += item.amount;
  }

  const newestFirst = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  return {
    recordCount: transactions.length,
    dateRange: transactions.length ? {
      from: [...transactions].sort((a, b) => a.date.localeCompare(b.date))[0].date,
      to: newestFirst[0].date,
    } : null,
    totals: { ...totals, balance: totals.income - totals.expense },
    byCategory,
    byAccount,
    recentExpenses: newestFirst.filter((item) => item.type === 'expense').slice(0, 10),
    recentIncome: newestFirst.filter((item) => item.type === 'income').slice(0, 10),
    transactions: newestFirst,
  };
}

function createFinanceParser(apiKey, model = 'gpt-4o-mini') {
  if (!apiKey) return null;
  const client = new OpenAI({ apiKey });

  return async function parseFinanceMessage({ text, categories, defaultAccount, currentDate, history = [], transactionContext = [] }) {
    const allowedCategories = categories.length ? categories : ['Бусад'];
    const financeContext = buildFinanceContext(transactionContext);
    const schema = {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['transactions', 'conversation', 'clarification'] },
        reply: { type: 'string' },
        transactions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              date: { type: 'string', description: 'YYYY-MM-DD формат' },
              type: { type: 'string', enum: ['income', 'expense'] },
              category: { type: 'string', enum: allowedCategories },
              note: { type: 'string' },
              account: { type: 'string', enum: ['Хувийн', 'Бизнес'] },
              amount: { type: 'integer', minimum: 1 },
            },
            required: ['date', 'type', 'category', 'note', 'account', 'amount'],
            additionalProperties: false,
          },
        },
      },
      required: ['mode', 'reply', 'transactions'],
      additionalProperties: false,
    };

    const response = await client.responses.create({
      model,
      store: false,
      input: [
        {
          role: 'system',
          content: [
            'Та Монгол хэрэглэгчийн санхүүгийн мессежийг бүтэцтэй гүйлгээ болгон задлана.',
            `Өнөөдрийн огноо ${currentDate}, цагийн бүс Asia/Ulaanbaatar.`,
            `Үндсэн бүртгэл: ${defaultAccount}.`,
            '“мянга”=1000, “сая”=1000000. Нэг мессежээс бүх гүйлгээг тусад нь гарга.',
            'Орсон, орлого, цалин, борлуулалт, урьдчилгаа нь ихэвчлэн орлого.',
            'Төлсөн, хоол, материал, бараа авсан нь ихэвчлэн зарлага.',
            'Такси, автобус, шатахуун, тээврийн зардлыг боломжтой бол “Тээвэр” ангилалд оруул.',
            'Дүн болон зориулалт тодорхой бол төрөл, ангилал, бүртгэлийг дээрх дүрэм ба үндсэн бүртгэлээр өөрөө сонго; хэрэглэгчээс дахин бүү асуу.',
            'Жишээ: “Таксинд 15 мянга зарцуулсан” гэвэл шууд expense, Тээвэр, үндсэн бүртгэл, 15000 гэсэн ноорог гарга. Энэ тохиолдолд clarification хориглоно.',
            'Захиалга, борлуулалт, материал, түүхий эдийг ихэвчлэн Бизнес; ахуйн хэрэглээг Хувийн гэж үз.',
            'Эргэлзээтэй ангиллыг хамгийн ойр зөвшөөрөгдсөн ангилалд оруул. Дүнгүй хэсгийг гүйлгээ болгохгүй.',
            'Данс хоорондын шилжүүлэг, зээл зэрэг тодорхойгүй зүйлийг таамгаар орлого/зарлага болгож бүү бүртгэ.',
            'Хэрэв гүйлгээ танигдвал mode=transactions, хадгалагдаагүй бөгөөд шалгах санал бэлэн болсныг хэлсэн товч Монгол reply, бүх гүйлгээг transactions-д буцаа.',
            'Хэрэглэгч баталгаажуулахаас өмнө “бүртгэж байна”, “бүртгэгдлээ”, “хадгалагдлаа” гэж хэзээ ч бүү хэл; зөвхөн “ноорог бэлэн” эсвэл “шалгаад баталгаажуулна уу” гэж хэл.',
            'Мэндчилгээ эсвэл ердийн асуулт бол mode=conversation, Монгол хэлээр найрсаг товч reply, transactions хоосон байна.',
            'Өмнөх ярианы утгыг санаж, залгамж асуултад контексттэй хариул. Хэрэглэгчийн хэл, өнгө аяст тохируулан ойлгомжтой, хэрэгтэй хариулт өг.',
            'Монгол кирилл, латин үсгээр бичсэн Монгол хэл болон үг үсгийн алдаатай асуултыг утгаар нь ойлго.',
            'Доорх хадгалсан гүйлгээний мэдээлэлд тулгуурлан нийт дүн, хамгийн их/бага ангилал, зарлагын хэв маяг, энгийн төсөв болон санхүүгийн зөвлөгөөний асуултад шууд хариул.',
            'Хадгалсан гүйлгээний тухай асуултыг mode=conversation болго. Мэдээлэл байвал дахин тодруулах асуулт асуулгүйгээр тооцоолж хариул.',
            'Тоо бодохдоо зөвхөн өгсөн гүйлгээг ашиглаж, ямар хугацаа эсвэл бүртгэлийг тооцсоноо товч тодорхой хэл.',
            '“Сүүлийн зарлагууд” гэвэл recentExpenses-ийг, “хоолны зардал” гэвэл byCategory дахь Хоол expense-ийг, “юунд их зарцуулсан” гэвэл byCategory expense-ийн хамгийн их дүнг ашигла.',
            `Хадгалсан санхүүгийн баталгаатай context: ${JSON.stringify(financeContext)}`,
            'Зөвхөн шинэ гүйлгээ нэмэх санаатай боловч дүн, төрөл эсвэл утга нь дутуу үед mode=clarification болгож нэг тодорхой асуулт асуу. Тайлан, зөвлөгөө, ердийн асуултад clarification бүү ашигла.',
            'Context-д recordCount 0 бол л хадгалсан гүйлгээ байхгүй гэж хэл. Context-д байгаа мэдээллийг харахгүй гэж хэзээ ч бүү хэл. Context-оос гадуур дүн зохиож болохгүй.',
          ].join('\n'),
        },
        ...history.map((item) => ({ role: item.role, content: item.text })),
        { role: 'user', content: text },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'finance_transactions',
          strict: true,
          schema,
        },
      },
    });

    if (!response.output_text) throw new Error('OPENAI_EMPTY_OUTPUT');
    return JSON.parse(response.output_text);
  };
}

module.exports = { createFinanceParser };
