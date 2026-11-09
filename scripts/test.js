/**
 * Executa a suite de testes em um banco SQLite isolado (prisma/test.db):
 * 1) recria o banco (migrations + seed)  2) roda node:test em tests/
 */
const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const env = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: 'file:./test.db',
  JWT_SECRET: process.env.JWT_SECRET || 'segredo-de-teste-com-pelo-menos-32-caracteres!!',
  PAYMENT_MOCK_LATENCY_MS: '0',
  LOGIN_RATE_LIMIT: '1000',
};
const raiz = path.join(__dirname, '..');
const run = (cmd) => execSync(cmd, { stdio: 'inherit', env, cwd: raiz });

// Banco descartavel exclusivo dos testes: removido e recriado a cada execucao.
for (const f of ['test.db', 'test.db-journal']) fs.rmSync(path.join(raiz, 'prisma', f), { force: true });
run('npx prisma migrate deploy');
run('node prisma/seed.js');
run('node --test --test-concurrency=1 "tests/*.test.js"');
