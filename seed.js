const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const parse = (f) => { const [h, ...r] = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/).map((l) => l.split(',')); return r; };
function build(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(fs.readFileSync(__dirname + '/schema.sql', 'utf8'));
  const ic = db.prepare('INSERT INTO customers VALUES (?,?,?,?,?,?,?,?)');
  const ip = db.prepare('INSERT INTO products VALUES (?,?,?,?,?)');
  const is = db.prepare('INSERT INTO stocks VALUES (?,?,?)');
  const io = db.prepare('INSERT INTO orders VALUES (?,?,?,?,?,?,?,?)');
  db.exec('BEGIN');
  for (const r of parse(__dirname + '/customers.csv')) ic.run(...r);
  for (const r of parse(__dirname + '/products.csv')) { ip.run(r[0], r[1], r[2], +r[3], +r[4]); is.run(r[0], r[0] === 'P018' ? 0 : 10, '2026-12-25'); }
  for (const r of parse(__dirname + '/orders.csv')) io.run(r[0], r[1], r[2], r[3], +r[4], +r[5], r[6], +r[7]);
  db.exec('COMMIT');
  return db;
}
module.exports = { build };
if (require.main === module) { const db = build(); for (const t of ['customers', 'products', 'stocks', 'orders']) console.log(t, db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c); }
