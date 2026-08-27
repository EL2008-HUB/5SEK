const { bootstrapEnv } = require("./src/config/bootstrapEnv");
bootstrapEnv(process.cwd());
const cfg = require("./knexfile");
const knex = require("knex")(cfg.development);

const PATTERNS = [
  "display%", "%name%", "%handle%", "%avatar%",
  "%push%", "%notif%",
  "%audio%", "%duration%", "%media%",
  "%watch%", "%session%",
  "last_active%",
];

(async () => {
  for (const p of PATTERNS) {
    const r = await knex.raw(
      `select table_name, column_name, data_type
       from information_schema.columns
       where table_schema='public' and column_name like ?
       order by table_name, column_name`,
      [p]
    );
    console.log(`\n--- columns LIKE '${p}' (${r.rows.length}) ---`);
    for (const c of r.rows) console.log(`  ${c.table_name}.${c.column_name} :: ${c.data_type}`);
  }

  const t = await knex.raw(
    `select table_name from information_schema.tables
     where table_schema='public' and table_type='BASE TABLE' order by table_name`
  );
  console.log(`\n=== ALL TABLES (${t.rows.length}) ===`);
  console.log(t.rows.map((r) => r.table_name).join(", "));
})()
  .catch((e) => console.error("ERR", e.message))
  .finally(() => knex.destroy());
