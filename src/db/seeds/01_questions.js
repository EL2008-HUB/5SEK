const { withQuestionQuality } = require("../../services/questionQuality");

/**
 * Seed starter questions with a content-quality prior.
 *
 * The goal is not more algorithm. The goal is a stronger question pool:
 * emotional trigger + relatability + curiosity gap.
 */

const QUESTION_BANK = [
  // Albania - direct, personal, emotional
  { text: "Cila këngë të kujton një moment që nuk e harron kurrë?", country: "AL", category: "music" },
  { text: "Kë do telefonoje nëse do kishe vetëm një telefonatë?", country: "AL", category: "relationships" },
  { text: "Çfarë mendimi ke frikë ta thuash me zë?", country: "AL", category: "confession" },
  { text: "Kush të mungon, edhe pse nuk ia pranon askujt?", country: "AL", category: "relationships" },
  { text: "Cili person të ndryshoi pa e ditur fare?", country: "AL", category: "personal" },
  { text: "Çfarë momenti të bën ende krenar?", country: "AL", category: "memory" },
  { text: "Cili mesazh do doje ta dërgoje sot?", country: "AL", category: "relationships" },
  { text: "Çfarë do bëje sot po të mos kishe frikë?", country: "AL", category: "imagination" },
  { text: "Çfarë nuk do t'ia thoje kurrë familjes?", country: "AL", category: "family" },
  { text: "Kush të ka zhgënjyer, por prapë e mbron?", country: "AL", category: "relationships" },

  // Kosovo - personal, social, direct
  { text: "Cila këngë të kthen menjëherë në një natë të vjetër?", country: "XK", category: "music" },
  { text: "Kë do e thirrje nëse ke vetëm një telefonatë?", country: "XK", category: "relationships" },
  { text: "Çfarë s'e pranon kurrë para shoqnisë?", country: "XK", category: "confession" },
  { text: "Kush të ka lënë shenjë pa e kuptu?", country: "XK", category: "personal" },
  { text: "Cili moment në shkollë të vjen ende në mendje?", country: "XK", category: "school" },
  { text: "Çfarë do ndryshoje te gjenerata jote?", country: "XK", category: "opinion" },
  { text: "Kush të mungon, por s'do ia shkruaje kurrë?", country: "XK", category: "relationships" },
  { text: "Çfarë do bëje nëse askush nuk të gjykon?", country: "XK", category: "imagination" },
  { text: "Cili sekret i vogël do t'i habiste shokët?", country: "XK", category: "confession" },
  { text: "Për çfarë ke punu fort dhe askush s'e pa?", country: "XK", category: "personal" },

  // USA - emotional hooks, pop-social language
  { text: "What song takes you back to one unforgettable night?", country: "US", category: "music" },
  { text: "Who changed your life without knowing it?", country: "US", category: "personal" },
  { text: "What opinion would get you roasted by your friends?", country: "US", category: "opinion" },
  { text: "Which text do you wish you had sent?", country: "US", category: "relationships" },
  { text: "What memory would you relive for one minute?", country: "US", category: "memory" },
  { text: "What lie did you tell that still follows you?", country: "US", category: "confession" },
  { text: "What tiny moment broke your trust?", country: "US", category: "relationships" },
  { text: "Who do you miss but refuse to text?", country: "US", category: "relationships" },
  { text: "What childhood belief do you secretly still love?", country: "US", category: "memory" },
  { text: "What would you do today with zero fear?", country: "US", category: "imagination" },

  // United Kingdom - dry, social, lightly self-deprecating
  { text: "What song makes you remember a messy night out?", country: "UK", category: "music" },
  { text: "Which mate gives the best terrible advice?", country: "UK", category: "funny" },
  { text: "What tiny inconvenience ruins your whole day?", country: "UK", category: "funny" },
  { text: "Who would you apologise to if pride vanished?", country: "UK", category: "relationships" },
  { text: "What opinion would start an argument at the pub?", country: "UK", category: "opinion" },
  { text: "What British habit secretly embarrasses you?", country: "UK", category: "personal" },
  { text: "Which message should you have never sent?", country: "UK", category: "relationships" },
  { text: "What memory still makes you cringe instantly?", country: "UK", category: "memory" },
  { text: "Who do you miss but pretend you don't?", country: "UK", category: "relationships" },
  { text: "What would you change if nobody judged you?", country: "UK", category: "imagination" },

  // Germany - thoughtful, direct, emotionally grounded
  { text: "Welches Lied erinnert dich an einen unvergesslichen Moment?", country: "DE", category: "music" },
  { text: "Wem würdest du schreiben, wenn Stolz egal wäre?", country: "DE", category: "relationships" },
  { text: "Welche Meinung traust du dich nicht laut zu sagen?", country: "DE", category: "opinion" },
  { text: "Wer hat dich verändert, ohne es zu wissen?", country: "DE", category: "personal" },
  { text: "Welchen Moment würdest du für eine Minute wiederholen?", country: "DE", category: "memory" },
  { text: "Was bereust du, obwohl es niemand weiss?", country: "DE", category: "confession" },
  { text: "Welche kleine Lüge verfolgt dich noch?", country: "DE", category: "confession" },
  { text: "Wem vertraust du, obwohl du es nicht solltest?", country: "DE", category: "relationships" },
  { text: "Was wuerdest du tun, wenn niemand urteilt?", country: "DE", category: "imagination" },
  { text: "Welche Regel in deinem Leben wuerdest du brechen?", country: "DE", category: "opinion" },

  // Turkey - family, emotion, direct
  { text: "Hangi şarkı seni unutamadığın bir ana götürür?", country: "TR", category: "music" },
  { text: "Kime mesaj atardın, gururun olmasaydı?", country: "TR", category: "relationships" },
  { text: "Annenin bilse şaşıracağı sırrın ne?", country: "TR", category: "family" },
  { text: "Hangi pişmanlık hâlâ aklına geliyor?", country: "TR", category: "confession" },
  { text: "Kim seni fark etmeden değiştirdi?", country: "TR", category: "personal" },
  { text: "Hangi anı bir dakikalığına tekrar yaşardın?", country: "TR", category: "memory" },
  { text: "Kime güveniyorsun ama aslında korkuyorsun?", country: "TR", category: "relationships" },
  { text: "Bugün korkmasan ne yapardın?", country: "TR", category: "imagination" },
  { text: "Ailene asla söyleyemeyeceğin düşünce ne?", country: "TR", category: "family" },
  { text: "Hangi söz seni hâlâ etkiliyor?", country: "TR", category: "personal" },

  // Italy - passionate, family, memory
  { text: "Quale canzone ti riporta a una notte indimenticabile?", country: "IT", category: "music" },
  { text: "A chi scriveresti se sparisse l'orgoglio?", country: "IT", category: "relationships" },
  { text: "Quale segreto stupirebbe la tua famiglia?", country: "IT", category: "family" },
  { text: "Quale rimpianto ti torna ancora in mente?", country: "IT", category: "confession" },
  { text: "Chi ti ha cambiato senza saperlo?", country: "IT", category: "personal" },
  { text: "Quale momento rivivresti per un minuto?", country: "IT", category: "memory" },
  { text: "Quale opinione scatenerebbe una cena di famiglia?", country: "IT", category: "opinion" },
  { text: "Di chi senti la mancanza ma non lo dici?", country: "IT", category: "relationships" },
  { text: "Cosa faresti oggi senza paura?", country: "IT", category: "imagination" },
  { text: "Quale bugia piccola ti segue ancora?", country: "IT", category: "confession" },

  // Global - universal prompts for cold start and cross-market sharing
  { text: "What song reminds you of someone you never forgot?", country: "GLOBAL", category: "music" },
  { text: "Who would you call with only one phone call left?", country: "GLOBAL", category: "relationships" },
  { text: "What opinion are you scared to say out loud?", country: "GLOBAL", category: "opinion" },
  { text: "What memory still changes your mood instantly?", country: "GLOBAL", category: "memory" },
  { text: "Who do you miss but will not text first?", country: "GLOBAL", category: "relationships" },
  { text: "What secret would surprise your friends?", country: "GLOBAL", category: "confession" },
  { text: "What would you do today if fear disappeared?", country: "GLOBAL", category: "imagination" },
  { text: "Which compliment do you still remember?", country: "GLOBAL", category: "personal" },
  { text: "What tiny betrayal taught you the most?", country: "GLOBAL", category: "relationships" },
  { text: "What moment made you proud but nobody noticed?", country: "GLOBAL", category: "personal" },
];

exports.seed = async function (knex) {
  await knex("questions").del();
  await knex("questions").insert(QUESTION_BANK.map(withQuestionQuality));
};
