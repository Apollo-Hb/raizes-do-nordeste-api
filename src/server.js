const { criarApp } = require('./app');
const env = require('./config/env');
const prisma = require('./infrastructure/database/prisma');

const app = criarApp();
const server = app.listen(env.port, () => {
  console.log(`Raizes do Nordeste API rodando em http://localhost:${env.port}`);
  console.log(`Swagger UI:            http://localhost:${env.port}/docs`);
});

// Encerramento gracioso: termina requisicoes em andamento e fecha conexoes do banco.
function encerrar(sinal) {
  console.log(`${sinal} recebido, encerrando...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));
