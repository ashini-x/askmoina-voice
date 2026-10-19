import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(
  readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
);
const previewMigrationConfig = JSON.parse(
  readFileSync(new URL("../wrangler.veda-preview-migrations.jsonc", import.meta.url), "utf8"),
);
const initialMigration = readFileSync(
  new URL("../migrations/veda/0001_initial.sql", import.meta.url),
  "utf8",
);

describe("Veda Phase 2 resource isolation", () => {
  const askMoinaProduction = config.d1_databases.find((db: { binding: string }) => db.binding === "DB");
  const askMoinaPreview = config.previews.d1_databases.find((db: { binding: string }) => db.binding === "DB");
  const vedaProduction = config.d1_databases.find((db: { binding: string }) => db.binding === "VEDA_DB");
  const vedaPreview = config.previews.d1_databases.find((db: { binding: string }) => db.binding === "VEDA_DB");

  it("binds production and preview to separately provisioned Veda D1 databases", () => {
    expect(vedaProduction).toEqual(expect.objectContaining({
      database_name: "veda-prod",
      database_id: expect.any(String),
      migrations_dir: "migrations/veda",
    }));
    expect(vedaPreview).toEqual(expect.objectContaining({
      database_name: "veda-preview",
      database_id: expect.any(String),
      migrations_dir: "migrations/veda",
    }));
    expect(vedaProduction.database_id).not.toBe(vedaPreview.database_id);
    expect(vedaProduction.database_id).not.toBe(askMoinaProduction.database_id);
    expect(vedaPreview.database_id).not.toBe(askMoinaPreview.database_id);
    expect(vedaProduction.database_name).not.toBe(askMoinaProduction.database_name);
    expect(vedaPreview.database_name).not.toBe(askMoinaPreview.database_name);
  });

  it("keeps the preview migration command pinned to Veda preview, never production", () => {
    expect(previewMigrationConfig.d1_databases).toEqual([
      expect.objectContaining({
        binding: "VEDA_DB",
        database_name: "veda-preview",
        database_id: vedaPreview.database_id,
        migrations_dir: "migrations/veda",
      }),
    ]);
  });

  it("provisions a dedicated SQLite Durable Object namespace in both deployment configurations", () => {
    expect(config.durable_objects.bindings).toContainEqual({
      name: "VEDA_SESSION_STATE",
      class_name: "VedaSessionState",
    });
    expect(config.previews.durable_objects.bindings).toContainEqual({
      name: "VEDA_SESSION_STATE",
      class_name: "VedaSessionState",
    });
    expect(config.exports.VedaSessionState).toEqual({
      type: "durable-object",
      storage: "sqlite",
    });
  });

  it("keeps Veda disabled and does not add durable raw-media/transcript columns", () => {
    expect(config.vars.VEDA_ENABLED).toBe("false");
    expect(config.previews.vars.VEDA_ENABLED).toBe("false");
    expect(initialMigration).toContain("CREATE TABLE IF NOT EXISTS veda_system_metadata");
    expect(initialMigration).toContain("CREATE TABLE IF NOT EXISTS veda_runtime_sessions");
    expect(initialMigration).not.toMatch(/\b(?:audio|video|transcript|recording)_?(?:blob|payload|content|text)\s+(?:TEXT|BLOB)\b/i);
    expect(initialMigration).not.toMatch(/CREATE TABLE IF NOT EXISTS (?:user_preferences|conversation_turns|user_memories)\b/i);
  });
});
