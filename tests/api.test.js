/**
 * Testes de integracao da API (HTTP real + banco SQLite de teste com seed).
 * Os IDs T01..T26 correspondem ao Plano de Testes (README/PDF) e a colecao Postman.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { criarApp } = require('../src/app');

let app;
let db;
const tk = {};
const estado = {};

const login = async (email) => {
  const r = await request(app).post('/auth/login').send({ email, senha: 'Senha@123' });
  assert.equal(r.status, 200, `login ${email}`);
  return r.body.accessToken;
};
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const pedidoBase = (extra = {}) => ({
  canalPedido: 'APP',
  unidadeId: 1,
  itens: [{ produtoId: 1, quantidade: 2 }, { produtoId: 3, quantidade: 1 }],
  formaPagamento: 'PIX',
  ...extra,
});

function assertErroPadrao(body, codigo) {
  assert.equal(body.error, codigo);
  assert.equal(typeof body.message, 'string');
  assert.ok(Array.isArray(body.details));
  assert.ok(body.timestamp);
  assert.ok(body.path);
  assert.ok(body.requestId);
}

before(async () => {
  app = criarApp({ backoffBaseMs: 1 });
  db = app.locals.container.db;
  tk.admin = await login('admin@raizes.com');
  tk.gerente = await login('gerente.recife@raizes.com');
  tk.atendente = await login('atendente.recife@raizes.com');
  tk.cozinha = await login('cozinha.recife@raizes.com');
  tk.gerenteSp = await login('gerente.sp@raizes.com');
});

after(async () => {
  await db.$disconnect();
});

// ---------------- Autenticacao e autorizacao ----------------
test('T01 login valido retorna token JWT', async () => {
  const r = await request(app).post('/auth/login').send({ email: 'maria@cliente.com', senha: 'Senha@123' });
  assert.equal(r.status, 200);
  assert.equal(r.body.tokenType, 'Bearer');
  assert.ok(r.body.accessToken.split('.').length === 3);
  assert.equal(r.body.user.perfil, 'CLIENTE');
  assert.equal(r.body.user.senhaHash, undefined);
  tk.maria = r.body.accessToken;
});

test('T02 login com senha errada retorna 401 padronizado', async () => {
  const r = await request(app).post('/auth/login').send({ email: 'maria@cliente.com', senha: 'errada' });
  assert.equal(r.status, 401);
  assertErroPadrao(r.body, 'CREDENCIAIS_INVALIDAS');
});

test('T03 acesso sem token retorna 401', async () => {
  const r = await request(app).get('/pedidos');
  assert.equal(r.status, 401);
  assertErroPadrao(r.body, 'TOKEN_AUSENTE');
});

test('T04 perfil sem permissao (CLIENTE criando produto) retorna 403', async () => {
  const r = await request(app).post('/produtos').set(auth(tk.maria)).send({ nome: 'X', categoria: 'TESTE', preco: 1 });
  assert.equal(r.status, 403);
  assertErroPadrao(r.body, 'ACESSO_NEGADO');
});

// ---------------- Catalogo ----------------
test('T05 cardapio da unidade lista produtos com preco local e disponibilidade', async () => {
  const r = await request(app).get('/unidades/2/cardapio');
  assert.equal(r.status, 200);
  const tapioca = r.body.itens.find((i) => i.produtoId === 1);
  assert.equal(tapioca.preco, 27.9); // preco regional de SP
  assert.ok(r.body.itens.every((i) => typeof i.disponivel === 'boolean'));
});

// ---------------- Pedido ----------------
test('T06 pedido com itens validos e criado (201) com canalPedido e total calculado', async () => {
  const r = await request(app).post('/pedidos').set(auth(tk.maria)).send(pedidoBase());
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'AGUARDANDO_PAGAMENTO');
  assert.equal(r.body.canalPedido, 'APP');
  assert.equal(r.body.total, 59.7); // 2 x 24,90 + 9,90
  assert.equal(r.headers.location, `/pedidos/${r.body.pedidoId}`);
  estado.pedidoAprovado = r.body.pedidoId;
});

test('T07 pedido sem canalPedido retorna 422 com campo indicado', async () => {
  const { canalPedido, ...semCanal } = pedidoBase();
  const r = await request(app).post('/pedidos').set(auth(tk.maria)).send(semCanal);
  assert.equal(r.status, 422);
  assertErroPadrao(r.body, 'VALIDACAO');
  assert.ok(r.body.details.some((d) => d.field === 'canalPedido'));
});

test('T08 canal invalido e quantidade negativa retornam 422', async () => {
  const r = await request(app)
    .post('/pedidos')
    .set(auth(tk.maria))
    .send(pedidoBase({ canalPedido: 'FAX', itens: [{ produtoId: 1, quantidade: -2 }] }));
  assert.equal(r.status, 422);
  const campos = r.body.details.map((d) => d.field);
  assert.ok(campos.includes('canalPedido'));
  assert.ok(campos.includes('itens[0].quantidade'));
});

test('T09 pedido com produto inexistente retorna 404', async () => {
  const r = await request(app).post('/pedidos').set(auth(tk.maria)).send(pedidoBase({ itens: [{ produtoId: 9999, quantidade: 1 }] }));
  assert.equal(r.status, 404);
  assertErroPadrao(r.body, 'PRODUTO_NAO_ENCONTRADO');
});

test('T10 pedido com unidade inexistente retorna 404', async () => {
  const r = await request(app).post('/pedidos').set(auth(tk.maria)).send(pedidoBase({ unidadeId: 999 }));
  assert.equal(r.status, 404);
  assertErroPadrao(r.body, 'UNIDADE_NAO_ENCONTRADO');
});

test('T11 pedido com estoque insuficiente retorna 409', async () => {
  const r = await request(app).post('/pedidos').set(auth(tk.maria)).send(pedidoBase({ itens: [{ produtoId: 4, quantidade: 10 }] }));
  assert.equal(r.status, 409);
  assertErroPadrao(r.body, 'ESTOQUE_INSUFICIENTE');
  assert.equal(r.body.details[0].issue, 'Disponivel: 3');
});

// ---------------- Pagamento mock ----------------
test('T12 pagamento mock aprovado atualiza pedido para PAGO e credita pontos', async () => {
  const r = await request(app).post('/pagamentos').set(auth(tk.maria)).send({ pedidoId: estado.pedidoAprovado, tokenPagamento: 'tok_aprovado' });
  assert.equal(r.status, 201);
  assert.equal(r.body.pagamento.status, 'APROVADO');
  assert.ok(r.body.pagamento.transacaoExternaId.startsWith('mock_txn_'));
  assert.equal(r.body.pedido.status, 'PAGO');
  assert.equal(r.body.pontosCreditados, 59);
});

test('T13 pagamento mock recusado: pedido PAGAMENTO_RECUSADO e mensagem coerente', async () => {
  const p = await request(app).post('/pedidos').set(auth(tk.maria)).send(pedidoBase({ canalPedido: 'TOTEM' }));
  estado.pedidoRecusado = p.body.pedidoId;
  const r = await request(app).post('/pagamentos').set(auth(tk.maria)).send({ pedidoId: p.body.pedidoId, tokenPagamento: 'tok_recusado' });
  assert.equal(r.status, 201);
  assert.equal(r.body.pagamento.status, 'RECUSADO');
  assert.equal(r.body.pagamento.codigoRetorno, 'SALDO_INSUFICIENTE');
  assert.match(r.body.pagamento.mensagem, /recusado/i);
  assert.equal(r.body.pedido.status, 'PAGAMENTO_RECUSADO');
  assert.equal(r.body.pontosCreditados, 0);
});

test('T14 pagar pedido ja pago retorna 409', async () => {
  const r = await request(app).post('/pagamentos').set(auth(tk.maria)).send({ pedidoId: estado.pedidoAprovado });
  assert.equal(r.status, 409);
  assertErroPadrao(r.body, 'PEDIDO_JA_PAGO');
});

test('T15 gateway indisponivel: 503 apos retries e pedido continua aguardando', async () => {
  const p = await request(app).post('/pedidos').set(auth(tk.maria)).send(pedidoBase({ canalPedido: 'WEB' }));
  const r = await request(app).post('/pagamentos').set(auth(tk.maria)).send({ pedidoId: p.body.pedidoId, tokenPagamento: 'tok_indisponivel' });
  assert.equal(r.status, 503);
  assertErroPadrao(r.body, 'GATEWAY_PAGAMENTO_INDISPONIVEL');
  const ped = await request(app).get(`/pedidos/${p.body.pedidoId}`).set(auth(tk.maria));
  assert.equal(ped.body.status, 'AGUARDANDO_PAGAMENTO');
  assert.equal(ped.body.pagamentos[0].status, 'ERRO');
});

// ---------------- Status do pedido ----------------
test('T16 cozinha move pedido PAGO -> EM_PREPARO -> PRONTO e atendente entrega', async () => {
  const id = estado.pedidoAprovado;
  let r = await request(app).patch(`/pedidos/${id}/status`).set(auth(tk.cozinha)).send({ status: 'EM_PREPARO' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'EM_PREPARO');
  r = await request(app).patch(`/pedidos/${id}/status`).set(auth(tk.cozinha)).send({ status: 'PRONTO' });
  assert.equal(r.body.status, 'PRONTO');
  r = await request(app).patch(`/pedidos/${id}/status`).set(auth(tk.atendente)).send({ status: 'ENTREGUE' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'ENTREGUE');
  assert.deepEqual(
    r.body.historicoStatus.map((h) => h.para),
    ['AGUARDANDO_PAGAMENTO', 'PAGO', 'EM_PREPARO', 'PRONTO', 'ENTREGUE'],
  );
});

test('T17 transicao de status invalida retorna 409', async () => {
  const r = await request(app).patch(`/pedidos/${estado.pedidoRecusado}/status`).set(auth(tk.cozinha)).send({ status: 'PRONTO' });
  assert.equal(r.status, 409);
  assertErroPadrao(r.body, 'TRANSICAO_STATUS_INVALIDA');
});

test('T18 funcionario de outra unidade nao enxerga o pedido (404)', async () => {
  const r = await request(app).get(`/pedidos/${estado.pedidoAprovado}`).set(auth(tk.gerenteSp));
  assert.equal(r.status, 404);
});

// ---------------- Multicanalidade ----------------
test('T19 atendente registra pedido no canal BALCAO para cliente identificado', async () => {
  const r = await request(app)
    .post('/pedidos')
    .set(auth(tk.atendente))
    .send(pedidoBase({ canalPedido: 'BALCAO', clienteId: 7, formaPagamento: 'CARTAO_DEBITO' }));
  assert.equal(r.status, 201);
  assert.equal(r.body.canalPedido, 'BALCAO');
  assert.equal(r.body.atendenteId, 3);
});

test('T20 filtro de pedidos por canal (?canalPedido=TOTEM)', async () => {
  const r = await request(app).get('/pedidos?canalPedido=TOTEM&page=1&limit=10').set(auth(tk.gerente));
  assert.equal(r.status, 200);
  assert.ok(r.body.data.length >= 1);
  assert.ok(r.body.data.every((p) => p.canalPedido === 'TOTEM'));
  assert.equal(r.body.meta.page, 1);
});

// ---------------- Idempotencia, cancelamento e auditoria ----------------
test('T21 Idempotency-Key repetida nao duplica o pedido', async () => {
  const key = 'teste-idem-0001';
  const a = await request(app).post('/pedidos').set(auth(tk.maria)).set('Idempotency-Key', key).send(pedidoBase());
  const b = await request(app).post('/pedidos').set(auth(tk.maria)).set('Idempotency-Key', key).send(pedidoBase());
  assert.equal(a.status, 201);
  assert.equal(b.status, 200);
  assert.equal(b.headers['idempotent-replayed'], 'true');
  assert.equal(a.body.pedidoId, b.body.pedidoId);
  estado.pedidoCancelar = a.body.pedidoId;
});

test('T22 cancelamento devolve o estoque e registra auditoria', async () => {
  const antes = await db.estoque.findUnique({ where: { unidadeId_produtoId: { unidadeId: 1, produtoId: 1 } } });
  const r = await request(app).post(`/pedidos/${estado.pedidoCancelar}/cancelamento`).set(auth(tk.maria)).send({ motivo: 'Desisti da compra' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'CANCELADO');
  const depois = await db.estoque.findUnique({ where: { unidadeId_produtoId: { unidadeId: 1, produtoId: 1 } } });
  assert.equal(depois.quantidade, antes.quantidade + 2);
});

test('T23 acao sensivel gera registro de auditoria consultavel pelo ADMIN', async () => {
  const r = await request(app).get(`/auditoria?entidade=Pedido&entidadeId=${estado.pedidoCancelar}`).set(auth(tk.admin));
  assert.equal(r.status, 200);
  const acoes = r.body.data.map((a) => a.acao);
  assert.ok(acoes.includes('PEDIDO_CRIADO'));
  assert.ok(acoes.includes('PEDIDO_CANCELADO'));
  const cancel = r.body.data.find((a) => a.acao === 'PEDIDO_CANCELADO');
  assert.equal(cancel.usuarioId, 6);
  assert.ok(cancel.requestId);
});

// ---------------- Estoque ----------------
test('T24 gerente movimenta estoque da propria unidade e e bloqueado em outra', async () => {
  const ok = await request(app).post('/estoque/movimentacoes').set(auth(tk.gerente)).send({ unidadeId: 1, produtoId: 4, tipo: 'ENTRADA', quantidade: 20, motivo: 'Reposicao' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.saldoAtual, 23);
  const negado = await request(app).post('/estoque/movimentacoes').set(auth(tk.gerente)).send({ unidadeId: 2, produtoId: 1, tipo: 'ENTRADA', quantidade: 1 });
  assert.equal(negado.status, 403);
});

// ---------------- LGPD / fidelidade ----------------
test('T25 cadastro com e-mail invalido retorna 422 e cadastro valido nao expoe senha', async () => {
  const inv = await request(app).post('/usuarios').send({ nome: 'Ana', email: 'ana-sem-arroba', senha: 'Senha@123' });
  assert.equal(inv.status, 422);
  assert.ok(inv.body.details.some((d) => d.field === 'email'));
  const ok = await request(app).post('/usuarios').send({ nome: 'Ana Teste', email: 'ana@teste.com', senha: 'Senha@123', consentimentoFidelidade: false });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.senhaHash, undefined);
  assert.equal(ok.body.consentimentos.FIDELIDADE.concedido, false);
  const hash = (await db.usuario.findUnique({ where: { email: 'ana@teste.com' } })).senhaHash;
  assert.match(hash, /^\$2[aby]\$/); // bcrypt
});

test('T26 resgate de pontos sem consentimento e bloqueado (LGPD)', async () => {
  const t = await login('ana@teste.com');
  const r = await request(app).post('/pedidos').set(auth(t)).send(pedidoBase({ usarPontos: 10 }));
  assert.equal(r.status, 422);
  assertErroPadrao(r.body, 'CONSENTIMENTO_NECESSARIO');
});

test('T27 saldo de fidelidade da cliente com consentimento', async () => {
  const r = await request(app).get('/fidelidade/saldo').set(auth(tk.maria));
  assert.equal(r.status, 200);
  assert.equal(r.body.consentimentoAtivo, true);
  assert.equal(r.body.saldoPontos, 259); // 200 (seed) + 59 (T12)
});

test('T28 titular anonimiza a conta e o token deixa de valer', async () => {
  const t = await login('ana@teste.com');
  const exp = await request(app).get('/usuarios/me/dados').set(auth(t));
  assert.equal(exp.status, 200);
  assert.equal(exp.body.titular.email, 'ana@teste.com');
  const del = await request(app).delete('/usuarios/me').set(auth(t));
  assert.equal(del.status, 204);
  const depois = await request(app).get('/usuarios/me').set(auth(t));
  assert.equal(depois.status, 401);
  const relogin = await request(app).post('/auth/login').send({ email: 'ana@teste.com', senha: 'Senha@123' });
  assert.equal(relogin.status, 401);
});

test('T29 relatorio de vendas por canal para a matriz', async () => {
  const r = await request(app).get('/relatorios/vendas').set(auth(tk.admin));
  assert.equal(r.status, 200);
  assert.ok(r.body.porCanal.some((c) => c.canalPedido === 'APP'));
  assert.ok(r.body.faturamento > 0);
});

test('T30 JSON malformado retorna 400 no padrao de erro', async () => {
  const r = await request(app).post('/pedidos').set(auth(tk.maria)).set('Content-Type', 'application/json').send('{"canalPedido": ');
  assert.equal(r.status, 400);
  assertErroPadrao(r.body, 'REQUISICAO_INVALIDA');
});
