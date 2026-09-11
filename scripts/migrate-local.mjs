import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const files = readdirSync('drizzle')
  .filter((f) => /^\d+.*\.sql$/.test(f))
  .sort();
const args = [
  'wrangler',
  'd1',
  'execute',
  'DB',
  '--local',
  '--config',
  'wrangler.local.json',
];
if (process.env.ANOTA_DB_PERSIST_TO)
  args.push('--persist-to', process.env.ANOTA_DB_PERSIST_TO);
execFileSync(
  'npx',
  [
    ...args,
    '--command',
    'CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY NOT NULL)',
  ],
  { stdio: 'pipe' },
);
const result = JSON.parse(
  execFileSync(
    'npx',
    [...args, '--command', 'SELECT name FROM _local_migrations', '--json'],
    { encoding: 'utf8' },
  ),
);
const applied = new Set(result[0].results.map((r) => r.name));
for (const file of files) {
  if (applied.has(file)) continue;
  execFileSync('npx', [...args, '--file', 'drizzle/' + file], {
    stdio: 'inherit',
  });
  execFileSync(
    'npx',
    [
      ...args,
      '--command',
      `INSERT INTO _local_migrations(name) VALUES ('${file.replaceAll("'", "''")}')`,
    ],
    { stdio: 'pipe' },
  );
  console.log('Applied', file);
}
console.log('Local migrations are up to date.');
