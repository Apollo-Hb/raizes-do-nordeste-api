const { PrismaClient } = require('@prisma/client');

// Instancia unica do cliente ORM (pool de conexoes compartilhado).
const prisma = new PrismaClient();

module.exports = prisma;
