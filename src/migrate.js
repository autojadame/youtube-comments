import fs from "fs";
import path from "path";
import { openDb } from "./db.js";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");

function listSqlFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith(".sql"))
    .sort();
}

async function main() {
  const db = openDb(process.env.DB_FILE || null);

  const files = listSqlFiles(MIGRATIONS_DIR);
  for (const f of files) {
    const p = path.join(MIGRATIONS_DIR, f);
    const sql = fs.readFileSync(p, "utf8");
    console.log(`[migrate] applying ${f}`);
    await new Promise((resolve, reject) => {
      db.exec(sql, (err) => (err ? reject(err) : resolve(true)));
    });
  }

  console.log("[migrate] done");
  db.close();
}

main().catch((e) => {
  console.error("[migrate] failed", e);
  process.exit(1);
});
