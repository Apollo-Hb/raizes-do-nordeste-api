/**
 * Gera postman/raizes-do-nordeste.postman_collection.json (Postman v2.1).
 * Cada requisicao possui testes (pm.test) com o status e trechos esperados do response,
 * espelhando o Plano de Testes (T01..T30). Uso: node scripts/gerar-postman.js
 */
const fs = require('node:fs');
const path = require('node:path');

const json = (o) => JSON.stringify(o, null, 2);

function req(nome, { method = 'GET', url, token, body, rawBody, headers = [], tests = [], pre = [] }) {
  const h = [...headers];
  if (body !== undefined || rawBody !== undefined) h.push({ key: 'Content-Type', value: 'application/json' });
  if (token) h.push({ key: 'Authorization', value: `Bearer {{${token}}}` });
  const [caminho, query] = url.split('?');
  const item = {
    name: nome,
    request: {
      method,
      header: h,
      url: {
        raw: `{{baseUrl}}${url}`,
        host: ['{{baseUrl}}'],
        path: caminho.split('/').filter(Boolean),
        ...(query ? { query: query.split('&').map((kv) => ({ key: kv.split('=')[0], value: kv.split('=')[1] })) } : {}),
      },
    },
    event: [],
  };
  if (body !== undefined || rawBody !== undefined) {
    item.request.body = { mode: 'raw', raw: rawBody ?? json(body).replace(/"(\{\{pedido\w*\}\})"/g, '$1'), options: { raw: { language: 'json' } } };
  }
  if (pre.length) item.event.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: pre } });
  if (tests.length) item.event.push({ listen: 'test', script: { type: 'text/javascript', exec: tests } });
  return item;
}

const status = (c) => `pm.test('Status ${c}', () => pm.response.to.have.status(${c}));`;
const erro = (codigo) => [
  `pm.test('Erro padronizado ${codigo}', () => {`,
  '  const b = pm.response.json();',
  `  pm.expect(b.error).to.eql('${codigo}');`,
  "  pm.expect(b).to.have.all.keys('error','message','details','timestamp','path','requestId');",
  '});',
];
const salvarToken = (v) => [status(200), `pm.collectionVariables.set('${v}', pm.response.json().accessToken);`];
const login = (nome, email, v) =>
  req(nome, { method: 'POST', url: '/auth/login', body: { email, senha: 'Senha@123' }, tests: salvarToken(v) });

const pedido = (extra = {}) => ({
  canalPedido: 'APP',
  unidadeId: 1,
  itens: [
    { produtoId: 1, quantidade: 2 },
    { produtoId: 3, quantidade: 1 },
  ],
  formaPagamento: 'PIX',
  ...extra,
});

const pastas = [
  {
    name: '00 Setup (logins por perfil)',
    item: [
      login('Login ADMIN', 'admin@raizes.com', 'tokenAdmin'),
      login('Login GERENTE Recife', 'gerente.recife@raizes.com', 'tokenGerente'),
      login('Login ATENDENTE Recife', 'atendente.recife@raizes.com', 'tokenAtendente'),
      login('Login COZINHA Recife', 'cozinha.recife@raizes.com', 'tokenCozinha'),
      login('Login GERENTE Sao Paulo', 'gerente.sp@raizes.com', 'tokenGerenteSp'),
      req('Health check', { url: '/health', tests: [status(200), "pm.test('UP', () => pm.expect(pm.response.json().status).to.eql('UP'));"] }),
    ],
  },
  {
    name: '01 Auth',
    item: [
      req('T01 Login valido (CLIENTE)', {
        method: 'POST',
        url: '/auth/login',
        body: { email: 'maria@cliente.com', senha: 'Senha@123' },
        tests: [
          status(200),
          "pm.test('Retorna accessToken Bearer sem dados sensiveis', () => {",
          '  const b = pm.response.json();',
          "  pm.expect(b.tokenType).to.eql('Bearer');",
          "  pm.expect(b.accessToken.split('.')).to.have.length(3);",
          "  pm.expect(b.user).to.not.have.property('senhaHash');",
          '});',
          "pm.collectionVariables.set('tokenCliente', pm.response.json().accessToken);",
        ],
      }),
      req('T02 Login com senha invalida (401)', {
        method: 'POST',
        url: '/auth/login',
        body: { email: 'maria@cliente.com', senha: 'senhaErrada1' },
        tests: [status(401), ...erro('CREDENCIAIS_INVALIDAS')],
      }),
      req('T03 Listar pedidos sem token (401)', { url: '/pedidos', tests: [status(401), ...erro('TOKEN_AUSENTE')] }),
      req('T04 CLIENTE tenta criar produto (403)', {
        method: 'POST',
        url: '/produtos',
        token: 'tokenCliente',
        body: { nome: 'Produto X', categoria: 'TESTE', preco: 10 },
        tests: [status(403), ...erro('ACESSO_NEGADO')],
      }),
    ],
  },
  {
    name: '02 Catalogo',
    item: [
      req('Listar unidades (paginado)', { url: '/unidades?page=1&limit=10', tests: [status(200), "pm.test('meta', () => pm.expect(pm.response.json().meta.page).to.eql(1));"] }),
      req('T05 Cardapio da unidade 2 (preco regional)', {
        url: '/unidades/2/cardapio',
        tests: [
          status(200),
          "pm.test('Tapioca com preco local 27.90', () => {",
          '  const t = pm.response.json().itens.find((i) => i.produtoId === 1);',
          '  pm.expect(t.preco).to.eql(27.9);',
          '});',
        ],
      }),
      req('Listar produtos por categoria', { url: '/produtos?categoria=BEBIDA&page=1&limit=10', tests: [status(200)] }),
      req('Listar promocoes vigentes', { url: '/promocoes', tests: [status(200)] }),
    ],
  },
  {
    name: '03 Pedidos',
    item: [
      req('T06 Criar pedido valido canal APP (201)', {
        method: 'POST',
        url: '/pedidos',
        token: 'tokenCliente',
        body: pedido(),
        tests: [
          status(201),
          "pm.test('AGUARDANDO_PAGAMENTO, canal APP e total 59.70', () => {",
          '  const b = pm.response.json();',
          "  pm.expect(b.status).to.eql('AGUARDANDO_PAGAMENTO');",
          "  pm.expect(b.canalPedido).to.eql('APP');",
          '  pm.expect(b.total).to.eql(59.7);',
          '});',
          "pm.collectionVariables.set('pedidoId', pm.response.json().pedidoId);",
        ],
      }),
      req('T07 Criar pedido sem canalPedido (422)', {
        method: 'POST',
        url: '/pedidos',
        token: 'tokenCliente',
        body: (({ canalPedido, ...r }) => r)(pedido()),
        tests: [status(422), ...erro('VALIDACAO'), "pm.test('Aponta canalPedido', () => pm.expect(pm.response.json().details.map(d => d.field)).to.include('canalPedido'));"],
      }),
      req('T08 Canal invalido e quantidade negativa (422)', {
        method: 'POST',
        url: '/pedidos',
        token: 'tokenCliente',
        body: pedido({ canalPedido: 'FAX', itens: [{ produtoId: 1, quantidade: -2 }] }),
        tests: [status(422), ...erro('VALIDACAO'), "pm.test('Aponta quantidade', () => pm.expect(pm.response.json().details.map(d => d.field)).to.include('itens[0].quantidade'));"],
      }),
      req('T09 Produto inexistente (404)', {
        method: 'POST',
        url: '/pedidos',
        token: 'tokenCliente',
        body: pedido({ itens: [{ produtoId: 9999, quantidade: 1 }] }),
        tests: [status(404), ...erro('PRODUTO_NAO_ENCONTRADO')],
      }),
      req('T10 Unidade inexistente (404)', {
        method: 'POST',
        url: '/pedidos',
        token: 'tokenCliente',
        body: pedido({ unidadeId: 999 }),
        tests: [status(404), ...erro('UNIDADE_NAO_ENCONTRADO')],
      }),
      req('T11 Estoque insuficiente (409)', {
        method: 'POST',
        url: '/pedidos',
        token: 'tokenCliente',
        body: pedido({ itens: [{ produtoId: 4, quantidade: 50 }, { produtoId: 4, quantidade: 50 }, { produtoId: 4, quantidade: 50 }] }),
        tests: [status(409), ...erro('ESTOQUE_INSUFICIENTE')],
      }),
    ],
  },
  {
    name: '04 Pagamento (mock)',
    item: [
      req('T12 Pagamento aprovado -> pedido PAGO', {
        method: 'POST',
        url: '/pagamentos',
        token: 'tokenCliente',
        body: { pedidoId: '{{pedidoId}}', tokenPagamento: 'tok_aprovado' },
        tests: [
          status(201),
          "pm.test('APROVADO e pedido PAGO', () => {",
          '  const b = pm.response.json();',
          "  pm.expect(b.pagamento.status).to.eql('APROVADO');",
          "  pm.expect(b.pedido.status).to.eql('PAGO');",
          "  pm.expect(b.pagamento.transacaoExternaId).to.match(/^mock_txn_/);",
          '  pm.expect(b.pontosCreditados).to.eql(59);',
          '});',
        ],
      }),
      req('T13a Criar pedido canal TOTEM', {
        method: 'POST',
        url: '/pedidos',
        token: 'tokenCliente',
        body: pedido({ canalPedido: 'TOTEM' }),
        tests: [status(201), "pm.collectionVariables.set('pedidoRecusadoId', pm.response.json().pedidoId);"],
      }),
      req('T13b Pagamento recusado -> PAGAMENTO_RECUSADO', {
        method: 'POST',
        url: '/pagamentos',
        token: 'tokenCliente',
        body: { pedidoId: '{{pedidoRecusadoId}}', tokenPagamento: 'tok_recusado' },
        tests: [
          status(201),
          "pm.test('RECUSADO com mensagem e pedido PAGAMENTO_RECUSADO', () => {",
          '  const b = pm.response.json();',
          "  pm.expect(b.pagamento.status).to.eql('RECUSADO');",
          "  pm.expect(b.pagamento.codigoRetorno).to.eql('SALDO_INSUFICIENTE');",
          '  pm.expect(b.pagamento.mensagem).to.match(/recusado/i);',
          "  pm.expect(b.pedido.status).to.eql('PAGAMENTO_RECUSADO');",
          '});',
        ],
      }),
      req('T14 Pagar pedido ja pago (409)', {
        method: 'POST',
        url: '/pagamentos',
        token: 'tokenCliente',
        body: { pedidoId: '{{pedidoId}}' },
        tests: [status(409), ...erro('PEDIDO_JA_PAGO')],
      }),
      req('T15a Criar pedido canal WEB', {
        method: 'POST',
        url: '/pedidos',
        token: 'tokenCliente',
        body: pedido({ canalPedido: 'WEB' }),
        tests: [status(201), "pm.collectionVariables.set('pedidoWebId', pm.response.json().pedidoId);"],
      }),
      req('T15b Gateway indisponivel apos retries (503)', {
        method: 'POST',
        url: '/pagamentos',
        token: 'tokenCliente',
        body: { pedidoId: '{{pedidoWebId}}', tokenPagamento: 'tok_indisponivel' },
        tests: [status(503), ...erro('GATEWAY_PAGAMENTO_INDISPONIVEL')],
      }),
      req('T15c Pedido continua AGUARDANDO_PAGAMENTO com tentativa ERRO', {
        url: '/pedidos/{{pedidoWebId}}',
        token: 'tokenCliente',
        tests: [
          status(200),
          "pm.test('Status preservado', () => {",
          '  const b = pm.response.json();',
          "  pm.expect(b.status).to.eql('AGUARDANDO_PAGAMENTO');",
          "  pm.expect(b.pagamentos[0].status).to.eql('ERRO');",
          '});',
        ],
      }),
    ],
  },
  {
    name: '05 Status do pedido',
    item: [
      req('T16a COZINHA inicia preparo (PAGO -> EM_PREPARO)', {
        method: 'PATCH',
        url: '/pedidos/{{pedidoId}}/status',
        token: 'tokenCozinha',
        body: { status: 'EM_PREPARO' },
        tests: [status(200), "pm.test('EM_PREPARO', () => pm.expect(pm.response.json().status).to.eql('EM_PREPARO'));"],
      }),
      req('T16b COZINHA marca PRONTO', {
        method: 'PATCH',
        url: '/pedidos/{{pedidoId}}/status',
        token: 'tokenCozinha',
        body: { status: 'PRONTO' },
        tests: [status(200), "pm.test('PRONTO', () => pm.expect(pm.response.json().status).to.eql('PRONTO'));"],
      }),
      req('T16c ATENDENTE entrega (ENTREGUE) + historico', {
        method: 'PATCH',
        url: '/pedidos/{{pedidoId}}/status',
        token: 'tokenAtendente',
        body: { status: 'ENTREGUE', observacao: 'Retirado no balcao' },
        tests: [
          status(200),
          "pm.test('Historico completo', () => {",
          "  pm.expect(pm.response.json().historicoStatus.map(h => h.para)).to.eql(['AGUARDANDO_PAGAMENTO','PAGO','EM_PREPARO','PRONTO','ENTREGUE']);",
          '});',
        ],
      }),
      req('T17 Transicao invalida (409)', {
        method: 'PATCH',
        url: '/pedidos/{{pedidoRecusadoId}}/status',
        token: 'tokenCozinha',
        body: { status: 'PRONTO' },
        tests: [status(409), ...erro('TRANSICAO_STATUS_INVALIDA')],
      }),
      req('T18 Gerente de outra unidade nao ve o pedido (404)', {
        url: '/pedidos/{{pedidoId}}',
        token: 'tokenGerenteSp',
        tests: [status(404), ...erro('PEDIDO_NAO_ENCONTRADO')],
      }),
    ],
  },
  {
    name: '06 Multicanal',
    item: [
      req('T19 ATENDENTE cria pedido BALCAO para cliente', {
        method: 'POST',
        url: '/pedidos',
        token: 'tokenAtendente',
        body: pedido({ canalPedido: 'BALCAO', clienteId: 7, formaPagamento: 'CARTAO_DEBITO' }),
        tests: [status(201), "pm.test('canal BALCAO', () => pm.expect(pm.response.json().canalPedido).to.eql('BALCAO'));"],
      }),
      req('T20 Filtrar pedidos por canal (?canalPedido=TOTEM)', {
        url: '/pedidos?canalPedido=TOTEM&page=1&limit=10',
        token: 'tokenGerente',
        tests: [
          status(200),
          "pm.test('Somente TOTEM', () => {",
          '  const d = pm.response.json().data;',
          '  pm.expect(d.length).to.be.above(0);',
          "  d.forEach(p => pm.expect(p.canalPedido).to.eql('TOTEM'));",
          '});',
        ],
      }),
    ],
  },
  {
    name: '07 Idempotencia, cancelamento e auditoria',
    item: [
      req('T21a Criar pedido com Idempotency-Key', {
        method: 'POST',
        url: '/pedidos',
        token: 'tokenCliente',
        headers: [{ key: 'Idempotency-Key', value: '{{idemKey}}' }],
        body: pedido(),
        pre: ["pm.collectionVariables.set('idemKey', 'idem-' + Date.now());"],
        tests: [status(201), "pm.collectionVariables.set('pedidoCancelarId', pm.response.json().pedidoId);"],
      }),
      req('T21b Reenvio com a mesma chave nao duplica (200)', {
        method: 'POST',
        url: '/pedidos',
        token: 'tokenCliente',
        headers: [{ key: 'Idempotency-Key', value: '{{idemKey}}' }],
        body: pedido(),
        tests: [
          status(200),
          "pm.test('Mesmo pedidoId e header Idempotent-Replayed', () => {",
          "  pm.expect(String(pm.response.json().pedidoId)).to.eql(String(pm.collectionVariables.get('pedidoCancelarId')));",
          "  pm.expect(pm.response.headers.get('Idempotent-Replayed')).to.eql('true');",
          '});',
        ],
      }),
      req('T22 Cancelar pedido (devolve estoque)', {
        method: 'POST',
        url: '/pedidos/{{pedidoCancelarId}}/cancelamento',
        token: 'tokenCliente',
        body: { motivo: 'Desisti da compra' },
        tests: [status(200), "pm.test('CANCELADO', () => pm.expect(pm.response.json().status).to.eql('CANCELADO'));"],
      }),
      req('T23 Auditoria registra criacao e cancelamento (ADMIN)', {
        url: '/auditoria?entidade=Pedido&entidadeId={{pedidoCancelarId}}',
        token: 'tokenAdmin',
        tests: [
          status(200),
          "pm.test('PEDIDO_CRIADO e PEDIDO_CANCELADO registrados', () => {",
          '  const acoes = pm.response.json().data.map(a => a.acao);',
          "  pm.expect(acoes).to.include('PEDIDO_CRIADO');",
          "  pm.expect(acoes).to.include('PEDIDO_CANCELADO');",
          '});',
        ],
      }),
    ],
  },
  {
    name: '08 Estoque',
    item: [
      req('Consultar saldo da unidade 1 (GERENTE)', { url: '/estoque?unidadeId=1', token: 'tokenGerente', tests: [status(200)] }),
      req('T24a GERENTE registra ENTRADA na propria unidade (201)', {
        method: 'POST',
        url: '/estoque/movimentacoes',
        token: 'tokenGerente',
        body: { unidadeId: 1, produtoId: 4, tipo: 'ENTRADA', quantidade: 20, motivo: 'Reposicao' },
        tests: [status(201), "pm.test('saldoAtual numerico', () => pm.expect(pm.response.json().saldoAtual).to.be.a('number'));"],
      }),
      req('T24b GERENTE movimenta outra unidade (403)', {
        method: 'POST',
        url: '/estoque/movimentacoes',
        token: 'tokenGerente',
        body: { unidadeId: 2, produtoId: 1, tipo: 'ENTRADA', quantidade: 1 },
        tests: [status(403), ...erro('ACESSO_NEGADO')],
      }),
      req('Historico de movimentacoes', { url: '/estoque/movimentacoes?unidadeId=1&page=1&limit=5', token: 'tokenGerente', tests: [status(200)] }),
    ],
  },
  {
    name: '09 LGPD e Fidelidade',
    item: [
      req('T25a Cadastro com e-mail invalido (422)', {
        method: 'POST',
        url: '/usuarios',
        body: { nome: 'Ana', email: 'ana-sem-arroba', senha: 'Senha@123' },
        tests: [status(422), ...erro('VALIDACAO')],
      }),
      req('T25b Cadastro de cliente sem consentimento (201, sem senha)', {
        method: 'POST',
        url: '/usuarios',
        pre: ["pm.collectionVariables.set('emailNovo', 'ana.' + Date.now() + '@teste.com');"],
        rawBody: '{\n  "nome": "Ana Teste",\n  "email": "{{emailNovo}}",\n  "senha": "Senha@123",\n  "consentimentoFidelidade": false\n}',
        tests: [
          status(201),
          "pm.test('Nao expoe senha e registra consentimento negado', () => {",
          '  const b = pm.response.json();',
          "  pm.expect(b).to.not.have.property('senhaHash');",
          '  pm.expect(b.consentimentos.FIDELIDADE.concedido).to.eql(false);',
          '});',
        ],
      }),
      req('Login do novo cliente', {
        method: 'POST',
        url: '/auth/login',
        rawBody: '{ "email": "{{emailNovo}}", "senha": "Senha@123" }',
        tests: salvarToken('tokenNovo'),
      }),
      req('T26 Resgate de pontos sem consentimento (422)', {
        method: 'POST',
        url: '/pedidos',
        token: 'tokenNovo',
        body: pedido({ usarPontos: 10 }),
        tests: [status(422), ...erro('CONSENTIMENTO_NECESSARIO')],
      }),
      req('T27 Saldo de fidelidade (cliente com consentimento)', {
        url: '/fidelidade/saldo',
        token: 'tokenCliente',
        tests: [status(200), "pm.test('Consentimento ativo e saldo', () => { const b = pm.response.json(); pm.expect(b.consentimentoAtivo).to.eql(true); pm.expect(b.saldoPontos).to.be.above(0); });"],
      }),
      req('Extrato de pontos', { url: '/fidelidade/extrato?page=1&limit=10', token: 'tokenCliente', tests: [status(200)] }),
      req('T28a Exportar meus dados (portabilidade)', {
        url: '/usuarios/me/dados',
        token: 'tokenNovo',
        tests: [status(200), "pm.test('Contem titular', () => pm.expect(pm.response.json().titular.email).to.eql(pm.collectionVariables.get('emailNovo')));"],
      }),
      req('T28b Anonimizar minha conta (204)', { method: 'DELETE', url: '/usuarios/me', token: 'tokenNovo', tests: [status(204)] }),
      req('T28c Token do titular anonimizado deixa de valer (401)', { url: '/usuarios/me', token: 'tokenNovo', tests: [status(401), ...erro('TOKEN_INVALIDO')] }),
    ],
  },
  {
    name: '10 Matriz e Erros',
    item: [
      req('T29 Relatorio de vendas por canal/unidade (ADMIN)', {
        url: '/relatorios/vendas',
        token: 'tokenAdmin',
        tests: [status(200), "pm.test('Possui consolidado por canal', () => pm.expect(pm.response.json().porCanal.length).to.be.above(0));"],
      }),
      req('T30 JSON malformado (400)', {
        method: 'POST',
        url: '/pedidos',
        token: 'tokenCliente',
        rawBody: '{"canalPedido": ',
        tests: [status(400), ...erro('REQUISICAO_INVALIDA')],
      }),
      req('Rota inexistente (404)', { url: '/rota-que-nao-existe', tests: [status(404), ...erro('ROTA_NAO_ENCONTRADA')] }),
    ],
  },
];

const variaveis = [
  'tokenAdmin', 'tokenGerente', 'tokenAtendente', 'tokenCozinha', 'tokenGerenteSp', 'tokenCliente', 'tokenNovo',
  'pedidoId', 'pedidoRecusadoId', 'pedidoWebId', 'pedidoCancelarId', 'idemKey', 'emailNovo',
].map((key) => ({ key, value: '' }));

const colecao = {
  info: {
    name: 'Raizes do Nordeste API - Plano de Testes',
    description:
      'Colecao do Plano de Testes (T01-T30). Antes de executar: `npm run db:seed` e `npm start`. ' +
      'Execute a colecao inteira em ordem (Runner ou `npm run test:postman`). Senha dos usuarios: Senha@123.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: pastas,
  variable: variaveis,
};

const ambiente = {
  name: 'Raizes do Nordeste - Local',
  values: [{ key: 'baseUrl', value: 'http://localhost:3000', enabled: true }],
};

const dir = path.join(__dirname, '..', 'postman');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'raizes-do-nordeste.postman_collection.json'), json(colecao) + '\n');
fs.writeFileSync(path.join(dir, 'local.postman_environment.json'), json(ambiente) + '\n');
console.log('Colecao Postman gerada em postman/');
