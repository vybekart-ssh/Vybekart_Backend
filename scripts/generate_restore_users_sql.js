const fs = require('fs');
const path = require('path');

function usage() {
  // eslint-disable-next-line no-console
  console.error(
    'Usage: node scripts/generate_restore_users_sql.js <users.csv> <output.sql>',
  );
  process.exit(2);
}

function q(v) {
  if (v == null || v === '') return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function parseCsvLineNaive(line) {
  // This export looks like a simple comma-separated file without quoted commas.
  return line.split(',');
}

function parseRolesCell(raw) {
  const v = String(raw || '').trim();
  if (!v) return [];
  return v
    .split('|')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function main() {
  const csvPath = process.argv[2];
  const outPath = process.argv[3];
  if (!csvPath || !outPath) usage();

  const raw = fs.readFileSync(csvPath, 'utf8').trim();
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const header = parseCsvLineNaive(lines[0]);
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));

  const sql = [];
  sql.push('BEGIN;');
  sql.push(
    'CREATE TEMP TABLE IF NOT EXISTS tmp_restore_user (' +
      'id text, email text, phone text, name text, isActive boolean, roles text, createdAt timestamptz, updatedAt timestamptz' +
      ') ON COMMIT DROP;',
  );
  sql.push('TRUNCATE TABLE tmp_restore_user;');

  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLineNaive(lines[i]);
    if (row.length < header.length) continue;
    const id = row[idx.id];
    const email = row[idx.email];
    const phone = row[idx.phone] || null;
    const name = row[idx.name];
    const isActive = String(row[idx.isActive] || '').toUpperCase() === 'TRUE';
    const roles = parseRolesCell(row[idx.roles]); // e.g. BUYER|SELLER
    const createdAt = row[idx.createdAt];
    const updatedAt = row[idx.updatedAt];

    sql.push(
      `INSERT INTO tmp_restore_user(id,email,phone,name,isActive,roles,createdAt,updatedAt) VALUES (` +
        `${q(id)},${q(email)},${q(phone)},${q(name)},${isActive ? 'TRUE' : 'FALSE'},${q(roles.join('|'))},${q(createdAt)},${q(updatedAt)});`,
    );
  }

  sql.push(
    'INSERT INTO public."User" (id, email, phone, password, name, "isActive", roles, "createdAt", "updatedAt")',
  );
  // NOTE: We cannot recover passwords from this CSV.
  // This inserts a placeholder password. Users must reset password or login via OTP (if supported).
  sql.push(
    'SELECT id, email, phone, \'__RESTORED_NO_PASSWORD__\', name, COALESCE(isActive, true), ' +
      '(select array_agg(r::"Role") from unnest(string_to_array(roles, \'|\')) as r), ' +
      'createdAt, updatedAt',
  );
  sql.push('FROM tmp_restore_user');
  sql.push('ON CONFLICT (email) DO UPDATE SET');
  sql.push('  phone = EXCLUDED.phone,');
  sql.push('  name = EXCLUDED.name,');
  sql.push('  "isActive" = EXCLUDED."isActive",');
  sql.push('  roles = EXCLUDED.roles,');
  sql.push('  "updatedAt" = EXCLUDED."updatedAt";');
  sql.push('COMMIT;');

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, sql.join('\n'));

  // eslint-disable-next-line no-console
  console.log(`Wrote ${outPath} (${lines.length - 1} rows)`);
}

main();

