import { DatabaseSync } from 'node:sqlite';
const paths = ['C:/Users/OigwenTs/.cc-switch/cc-switch.db', 'C:/Users/OigwenTs/.config/clash/cache.db'];
for (const path of paths) {
  let db;
  try { db = new DatabaseSync(path, { readOnly: true }); } catch (e) { console.log('OPEN FAIL ' + path + ': ' + e.message); continue; }
  console.log('######## DB: ' + path);
  let tables = [];
  try { tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all(); } catch (e) { console.log('tables fail: ' + e.message); }
  for (const t of tables) {
    const name = t.name;
    let cols = [];
    try { cols = db.prepare('PRAGMA table_info(' + JSON.stringify(name) + ')').all(); } catch (e) { continue; }
    let rows = [];
    try { rows = db.prepare('SELECT * FROM ' + JSON.stringify(name)).all(); } catch (e) { console.log('-- table ' + name + ' select fail: ' + e.message); continue; }
    for (const row of rows) {
      const s = JSON.stringify(row);
      if (s.indexOf('猫') >= 0) {
        console.log('-- CATMATCH table=' + name + ':');
        for (const c of cols) {
          const v = row[c.name];
          if (typeof v === 'string' && v.indexOf('猫') >= 0) console.log('   ' + c.name + ' = ' + v);
        }
      }
    }
    console.log('table ' + name + ': ' + rows.length + ' rows');
    if (/provider/i.test(name) && rows.length > 0 && rows.length < 200) {
      console.log('### FULL rows of table ' + name + ':');
      for (const row of rows) console.log(JSON.stringify(row));
    }
  }
  db.close();
}
