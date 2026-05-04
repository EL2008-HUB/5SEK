/**
 * Smart Engine upgrade:
 *
 * 1. User profiling: age_group, interests (hyper-personalization)
 * 2. Question hotness: is_hot, hot_detected_at, age_group, interest_tags
 * 3. Pattern learning: question_patterns table
 * 4. Injection tracking: injection_log table
 */
exports.up = function (knex) {
  return knex.schema
    // ── User profiling ─────────────────────────────
    .alterTable("users", (table) => {
      // "13-17" | "18-24" | "25-34" | "35+" | null
      table.string("age_group", 10).nullable();
      // JSON array: ["memes","relationships","sports","music","food","gaming"]
      table.text("interests").nullable();
      table.index("age_group", "idx_users_age_group");
    })
    // ── Question targeting ─────────────────────────
    .alterTable("questions", (table) => {
      // Hot detection
      table.boolean("is_hot").defaultTo(false);
      table.timestamp("hot_detected_at").nullable();
      // Target audience
      table.string("age_group", 10).nullable(); // null = all ages
      // JSON array of interest tags this question targets
      table.text("interest_tags").nullable();
      table.index("is_hot", "idx_questions_hot");
    })
    // ── Pattern learning ───────────────────────────
    .createTable("question_patterns", (table) => {
      table.increments("id").primary();
      table.string("pattern_type").notNullable();
      // e.g. "format:a_vs_b", "length:short", "tone:direct", "topic:personal"
      table.string("pattern_value").notNullable();
      table.string("country", 10).defaultTo("GLOBAL");
      table.float("avg_score").defaultTo(0);
      table.integer("sample_count").defaultTo(0);
      table.float("success_rate").defaultTo(0); // 0-1
      table.timestamp("updated_at").defaultTo(knex.fn.now());
      table.unique(["pattern_type", "pattern_value", "country"], {
        indexName: "uq_pattern_country",
      });
    })
    // ── Injection log ──────────────────────────────
    .createTable("injection_log", (table) => {
      table.increments("id").primary();
      table.string("source").notNullable(); // "ai", "cross_country", "trending_clone"
      table.string("country", 10).notNullable();
      table.integer("questions_added").defaultTo(0);
      table.text("details").nullable(); // JSON metadata
      table.timestamp("created_at").defaultTo(knex.fn.now());
    });
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists("injection_log")
    .dropTableIfExists("question_patterns")
    .alterTable("questions", (table) => {
      table.dropIndex("is_hot", "idx_questions_hot");
      table.dropColumn("interest_tags");
      table.dropColumn("age_group");
      table.dropColumn("hot_detected_at");
      table.dropColumn("is_hot");
    })
    .alterTable("users", (table) => {
      table.dropIndex("age_group", "idx_users_age_group");
      table.dropColumn("interests");
      table.dropColumn("age_group");
    });
};
