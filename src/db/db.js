const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

let _db = null;

async function getDb() {
  if (_db) return _db;
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), "data.sqlite");
  _db = await open({ filename: dbPath, driver: sqlite3.Database });
  await _db.exec("PRAGMA foreign_keys = ON;");
  return _db;
}

module.exports = { getDb };
