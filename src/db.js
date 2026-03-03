import sqlite3 from "sqlite3";
import path from "path";

sqlite3.verbose();

export function openDb(dbFile = null) {
  const file = dbFile
    ? path.resolve(dbFile)
    : path.resolve(process.cwd(), "data.sqlite");

  const db = new sqlite3.Database(file);

  // Promisified helpers (keep original callback APIs too)
  db.runAsync = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
  db.getAsync = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)));
  });
  db.allAsync = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
  });

  db.serialize(() => {
    db.run("PRAGMA foreign_keys = ON;");
    db.run("PRAGMA journal_mode = WAL;");
  });

  return db;
}
