/**
 * Seed starter questions — with country tags
 *
 * Country codes:
 *   AL = Albania (Albanian language, direct/personal style)
 *   US = USA (English, funny/opinion-based)
 *   DE = Germany (German, logical/serious)
 *   XK = Kosovo (Albanian, personal)
 *   UK = United Kingdom (English, witty)
 *   TR = Turkey (Turkish, emotional)
 *   IT = Italy (Italian, passionate)
 *   GLOBAL = works everywhere (English, universal)
 */
exports.seed = async function (knex) {
  await knex("questions").del();

  await knex("questions").insert([
    // 🇦🇱 ALBANIA — personal, direct, provocative
    { text: "Kë urren pa arsye?", country: "AL", category: "personal" },
    { text: "Çfarë do të bëje nëse do të ishe i padukshëm për 1 ditë?", country: "AL", category: "imagination" },
    { text: "Cili është mendimi yt më i çuditshëm?", country: "AL", category: "personal" },
    { text: "Nëse do të mund të udhëtoje në kohë, ku do të shkoje?", country: "AL", category: "imagination" },
    { text: "Çfarë do të bëje me 1 milion euro?", country: "AL", category: "money" },
    { text: "Cila është gjëja më e guximshme që ke bërë ndonjëherë?", country: "AL", category: "personal" },
    { text: "Nëse do të ishe president për 1 ditë, çfarë do të ndryshoje?", country: "AL", category: "opinion" },
    { text: "Kush të ka zhgënjyer më shumë në jetë?", country: "AL", category: "personal" },
    { text: "Çfarë nuk do ta faleshe kurrë?", country: "AL", category: "personal" },
    { text: "Me kë person nuk do flesje kurrë në një dhomë?", country: "AL", category: "personal" },

    // 🇺🇸 USA — funny, opinion-based, pop culture
    { text: "iPhone or Android — pick one forever?", country: "US", category: "opinion" },
    { text: "What's your most unpopular opinion?", country: "US", category: "opinion" },
    { text: "What would your last meal on Earth be?", country: "US", category: "food" },
    { text: "If you could be any celebrity for a day, who?", country: "US", category: "imagination" },
    { text: "What's the dumbest thing you believed as a kid?", country: "US", category: "funny" },
    { text: "Dogs or cats — you can only pick one?", country: "US", category: "opinion" },
    { text: "What's the worst dating advice you've received?", country: "US", category: "funny" },
    { text: "Which movie do people love that you hate?", country: "US", category: "opinion" },
    { text: "What's the pettiest reason you dumped someone?", country: "US", category: "funny" },
    { text: "Pineapple on pizza — yes or absolutely not?", country: "US", category: "opinion" },

    // 🇩🇪 GERMANY — logical, serious opinion
    { text: "Was würdest du mit einer Million Euro machen?", country: "DE", category: "money" },
    { text: "Welche Regel würdest du abschaffen?", country: "DE", category: "opinion" },
    { text: "Was ist dein größtes Geheimnis?", country: "DE", category: "personal" },
    { text: "Wenn du ein Gesetz ändern könntest, welches?", country: "DE", category: "opinion" },
    { text: "Was war der beste Rat, den du je bekommen hast?", country: "DE", category: "personal" },
    { text: "Welche Superkraft hättest du gerne und warum?", country: "DE", category: "imagination" },
    { text: "Was nervt dich am meisten an Social Media?", country: "DE", category: "opinion" },
    { text: "Bier oder Wein — du kannst nur eins wählen?", country: "DE", category: "opinion" },

    // 🇽🇰 KOSOVO — Albanian, personal
    { text: "Kush të ka lënë përshtypje më shumë në jetë?", country: "XK", category: "personal" },
    { text: "Çfarë do bëje me 10 mijë euro tash?", country: "XK", category: "money" },
    { text: "Cili mësues i shkollës të ka lënë përshtypje?", country: "XK", category: "personal" },
    { text: "Ku do të jetoje nëse larg Kosovës?", country: "XK", category: "imagination" },
    { text: "Çka nuk e pelqen te gjenerata e re?", country: "XK", category: "opinion" },

    // 🇬🇧 UK — witty, dry humor
    { text: "Tea or coffee — you can only have one?", country: "UK", category: "opinion" },
    { text: "What's the most British thing you've ever done?", country: "UK", category: "funny" },
    { text: "What would you do if you were PM for a day?", country: "UK", category: "opinion" },
    { text: "What's a hill you're willing to die on?", country: "UK", category: "opinion" },
    { text: "What's the most overrated thing in the UK?", country: "UK", category: "opinion" },

    // 🇹🇷 TURKEY — emotional, passionate
    { text: "Hayatta en çok neyi pişman oldun?", country: "TR", category: "personal" },
    { text: "Eğer bir süper gücün olsaydı ne olurdu?", country: "TR", category: "imagination" },
    { text: "Annene hiç söyleyemediğin şey ne?", country: "TR", category: "personal" },
    { text: "Çay mı kahve mi — sadece birini seçebilirsin?", country: "TR", category: "opinion" },
    { text: "Son yemeğin ne olurdu?", country: "TR", category: "food" },

    // 🇮🇹 ITALY — passionate, food, dramatic
    { text: "Pizza o pasta — puoi mangiare solo uno per sempre?", country: "IT", category: "food" },
    { text: "Qual è il tuo segreto più grande?", country: "IT", category: "personal" },
    { text: "Cosa faresti con un milione di euro?", country: "IT", category: "money" },
    { text: "Quale legge cambieresti in Italia?", country: "IT", category: "opinion" },
    { text: "Chi è la persona che ammiri di più?", country: "IT", category: "personal" },

    // 🌍 GLOBAL — works everywhere, English
    { text: "What would you do with $1 million right now?", country: "GLOBAL", category: "money" },
    { text: "If you could have dinner with anyone, who would it be?", country: "GLOBAL", category: "imagination" },
    { text: "What's the craziest thing on your bucket list?", country: "GLOBAL", category: "imagination" },
    { text: "If you could master one skill instantly, what would it be?", country: "GLOBAL", category: "imagination" },
    { text: "What's the best advice you've ever received?", country: "GLOBAL", category: "personal" },
    { text: "What would your superpower be and why?", country: "GLOBAL", category: "imagination" },
    { text: "What's a secret talent nobody knows about?", country: "GLOBAL", category: "personal" },
    { text: "If you could relive one day of your life, which one?", country: "GLOBAL", category: "imagination" },
    { text: "What would you do if you had 5 seconds to answer any question?", country: "GLOBAL", category: "funny" },
    { text: "What's your most embarrassing moment?", country: "GLOBAL", category: "personal" },
  ]);
};
