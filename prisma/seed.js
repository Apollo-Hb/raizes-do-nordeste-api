/**
 * Seed de demonstracao - cria unidades, usuarios de cada perfil, produtos, estoque e promocoes.
 * Senha de todos os usuarios de teste: Senha@123
 * Execucao: npm run db:seed  (idempotente: limpa e recria os dados)
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();
const SENHA = 'Senha@123';

async function limpar() {
  // Ordem respeita as FKs.
  await prisma.auditLog.deleteMany();
  await prisma.transacaoFidelidade.deleteMany();
  await prisma.pagamento.deleteMany();
  await prisma.historicoStatusPedido.deleteMany();
  await prisma.movimentacaoEstoque.deleteMany();
  await prisma.itemPedido.deleteMany();
  await prisma.pedido.deleteMany();
  await prisma.promocao.deleteMany();
  await prisma.estoque.deleteMany();
  await prisma.produto.deleteMany();
  await prisma.consentimento.deleteMany();
  await prisma.usuario.deleteMany();
  await prisma.unidade.deleteMany();
  // Reinicia os contadores de ID do SQLite para os IDs do README/Postman serem previsiveis.
  await prisma.$executeRawUnsafe('DELETE FROM sqlite_sequence');
}

async function main() {
  await limpar();
  const senhaHash = await bcrypt.hash(SENHA, 10);

  const recife = await prisma.unidade.create({
    data: { nome: 'Raizes do Nordeste - Recife Boa Viagem', cidade: 'Recife', uf: 'PE', tipoCozinha: 'COMPLETA' },
  });
  const sp = await prisma.unidade.create({
    data: { nome: 'Raizes do Nordeste - Sao Paulo Paulista (express)', cidade: 'Sao Paulo', uf: 'SP', tipoCozinha: 'REDUZIDA' },
  });

  const usuarios = [
    { nome: 'Administrador Matriz', email: 'admin@raizes.com', perfil: 'ADMIN' },
    { nome: 'Gerente Recife', email: 'gerente.recife@raizes.com', perfil: 'GERENTE', unidadeId: recife.id },
    { nome: 'Atendente Recife', email: 'atendente.recife@raizes.com', perfil: 'ATENDENTE', unidadeId: recife.id },
    { nome: 'Cozinha Recife', email: 'cozinha.recife@raizes.com', perfil: 'COZINHA', unidadeId: recife.id },
    { nome: 'Gerente Sao Paulo', email: 'gerente.sp@raizes.com', perfil: 'GERENTE', unidadeId: sp.id },
    { nome: 'Maria Cliente', email: 'maria@cliente.com', perfil: 'CLIENTE' },
    { nome: 'Joao Cliente', email: 'joao@cliente.com', perfil: 'CLIENTE' },
  ];
  for (const u of usuarios) await prisma.usuario.create({ data: { ...u, senhaHash } });

  // Maria aceitou o programa de fidelidade; Joao nao (demonstra a regra de consentimento).
  const maria = await prisma.usuario.findUnique({ where: { email: 'maria@cliente.com' } });
  await prisma.consentimento.create({
    data: { usuarioId: maria.id, finalidade: 'FIDELIDADE', concedido: true, versaoTermo: 'v1.0-2026' },
  });
  await prisma.transacaoFidelidade.create({
    data: { usuarioId: maria.id, tipo: 'ACUMULO', pontos: 200, descricao: 'Bonus de boas-vindas (seed)' },
  });

  const ano = new Date().getFullYear();
  const produtos = [
    { nome: 'Tapioca de Carne de Sol com Queijo Coalho', categoria: 'TAPIOCA', preco: 24.9 },
    { nome: 'Cuscuz Recheado com Charque', categoria: 'CUSCUZ', preco: 22.5, exigeCozinhaCompleta: true },
    { nome: 'Bolo de Macaxeira (fatia)', categoria: 'BOLO', preco: 9.9 },
    { nome: 'Suco de Caja 500ml', categoria: 'BEBIDA', preco: 11.0 },
    { nome: 'Cafe Coado na Hora', categoria: 'BEBIDA', preco: 6.5 },
    {
      nome: 'Canjica Junina',
      categoria: 'SAZONAL',
      preco: 13.9,
      sazonal: true,
      disponivelDe: new Date(`${ano}-06-01T00:00:00Z`),
      disponivelAte: new Date(`${ano}-07-31T23:59:59Z`),
    },
  ];
  const criados = [];
  for (const p of produtos) criados.push(await prisma.produto.create({ data: p }));
  const [tapioca, cuscuz, bolo, suco, cafe, canjica] = criados;

  // Estoque/cardapio por unidade. Suco com estoque baixo em Recife para demonstrar o 409.
  const estoques = [
    [recife, tapioca, 50],
    [recife, cuscuz, 30],
    [recife, bolo, 40],
    [recife, suco, 3],
    [recife, cafe, 100],
    [recife, canjica, 20],
    [sp, tapioca, 25, 27.9], // preco regional
    [sp, bolo, 15],
    [sp, cafe, 60, 7.5],
  ];
  for (const [u, p, q, precoLocal] of estoques) {
    await prisma.estoque.create({ data: { unidadeId: u.id, produtoId: p.id, quantidade: q, precoLocal } });
    await prisma.movimentacaoEstoque.create({
      data: { unidadeId: u.id, produtoId: p.id, tipo: 'ENTRADA', quantidade: q, saldoApos: q, motivo: 'Carga inicial (seed)' },
    });
  }

  await prisma.promocao.createMany({
    data: [
      {
        codigo: 'BEMVINDO10',
        descricao: '10% de desconto em toda a rede',
        percentualDesconto: 10,
        inicio: new Date(`${ano}-01-01T00:00:00Z`),
        fim: new Date(`${ano + 1}-12-31T23:59:59Z`),
      },
      {
        codigo: 'APP15',
        descricao: '15% de desconto exclusivo para pedidos pelo aplicativo',
        percentualDesconto: 15,
        canalPedido: 'APP',
        inicio: new Date(`${ano}-01-01T00:00:00Z`),
        fim: new Date(`${ano + 1}-12-31T23:59:59Z`),
      },
    ],
  });

  console.log('Seed concluido. Usuarios de teste (senha Senha@123):');
  for (const u of usuarios) console.log(`  ${u.perfil.padEnd(9)} ${u.email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
