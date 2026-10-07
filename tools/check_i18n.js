// Every UI string passed to t() or marked data-i18n must have EN/ES in docs/i18n.js.
// Run: node tools/check_i18n.js
const fs = require('fs');
const path = require('path');
const docs = path.join(__dirname, '..', 'docs');
const src = fs.readFileSync(path.join(docs, 'i18n.js'), 'utf8');
const I18N = new Function(src.replace("'use strict';", '') + '; return I18N;')();
const app = fs.readFileSync(path.join(docs, 'app.js'), 'utf8') + fs.readFileSync(path.join(docs, 'venue.js'), 'utf8');
const html = fs.readFileSync(path.join(docs, 'index.html'), 'utf8');
const keys = new Set();
for (const m of app.matchAll(/\bt\('([^']+)'/g)) keys.add(m[1]);
for (const m of app.matchAll(/t\((?:[^()]*\? )'([^']+)' : '([^']+)'/g)) { keys.add(m[1]); keys.add(m[2]); }
for (const m of app.matchAll(/(?:text|title): '([^']+)'/g)) keys.add(m[1]);
for (const m of app.matchAll(/\['(?:✅|🟡|❌|⏭)', '([^']+)'\]/gu)) keys.add(m[1]);   // VERDICT_UI labels
for (const m of html.matchAll(/data-i18n(?:-title|-ph)?="([^"]+)"/g)) keys.add(m[1]);
const missing = [...keys].filter(k => !I18N[k]);
console.log(`${keys.size} keys, ${missing.length} missing`);
missing.forEach(k => console.log('  MISSING:', k));
process.exit(missing.length ? 1 : 0);
