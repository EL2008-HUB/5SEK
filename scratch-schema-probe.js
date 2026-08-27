const { bootstrapEnv } = require("./src/config/bootstrapEnv");
bootstrapEnv(process.cwd());
const cfg = require("./knexfile");
const knex = require("knex")(cfg.development);

const TABLES = process.env.PROBE_TABLES
  ? process.env.PROBE_TABLES.split(",")
  : ["users", "answers", "client_events", "comments"];

(async () => {
  for (const t of TABLES) {
    const has = await knex.schema.hasTable(t);
    if (!has) {
      console.log(`\n=== ${t} : TABLE DOES NOT EXIST ===`);
      continue;
    }
    const cols = await knex.raw(
      `select column_name, data_type, is_nullable, column_default
       from information_schema.columns
       where table_schema='public' and table_name = ?
       order by ordinal_position`,
      [t]
    );
    const cnt = await knex(t).count("* as n").first();
    console.log(`\n=== ${t} (${cnt.n} rows, ${cols.rows.length} cols) ===`);
    for (const c of cols.rows) {
      console.log(
        `  ${c.column_name} :: ${c.data_type}` +
          (c.is_nullable === "NO" ? " NOT NULL" : "") +
          (c.column_default ? ` default=${c.column_default}` : "")
      );
    }
  }
})()
  .catch((e) => console.error("ERR", e.message))
  .finally(() => knex.destroy());
