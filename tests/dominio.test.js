// Testes unitarios das regras de dominio (sem banco e sem HTTP).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calcularTotais, validarTransicao, verificarDisponibilidade, validarCanalParaPerfil } = require('../src/domain/pedido');
const { validarPromocao } = require('../src/domain/promocao');
const { pontosPorPagamento } = require('../src/domain/fidelidade');

test('calcularTotais aplica promocao e limita desconto de pontos a 50%', () => {
  const r = calcularTotais({
    itens: [{ produtoId: 1, quantidade: 2, precoUnitario: 10 }],
    percentualPromocao: 10,
    pontosSolicitados: 1000,
  });
  assert.equal(r.subtotal, 20);
  assert.equal(r.descontoPromocao, 2);
  assert.equal(r.descontoPontos, 9); // 50% de 18,00
  assert.equal(r.pontosResgatados, 90);
  assert.equal(r.total, 9);
});

test('calcularTotais evita erro de ponto flutuante', () => {
  const r = calcularTotais({ itens: [{ produtoId: 1, quantidade: 3, precoUnitario: 0.1 }] });
  assert.equal(r.total, 0.3);
});

test('maquina de estados: PAGO -> EM_PREPARO permitido para COZINHA', () => {
  assert.doesNotThrow(() => validarTransicao('PAGO', 'EM_PREPARO', 'COZINHA'));
});

test('maquina de estados: AGUARDANDO_PAGAMENTO -> PRONTO e invalido (409)', () => {
  assert.throws(() => validarTransicao('AGUARDANDO_PAGAMENTO', 'PRONTO', 'GERENTE'), (e) => e.status === 409);
});

test('maquina de estados: ATENDENTE nao pode iniciar preparo (403)', () => {
  assert.throws(() => validarTransicao('PAGO', 'EM_PREPARO', 'ATENDENTE'), (e) => e.status === 403);
});

test('produto que exige cozinha completa fica indisponivel em unidade reduzida', () => {
  const r = verificarDisponibilidade({
    produto: { ativo: true, exigeCozinhaCompleta: true },
    unidade: { tipoCozinha: 'REDUZIDA' },
    estoque: { quantidade: 10 },
    quantidade: 1,
  });
  assert.equal(r.ok, false);
});

test('produto sazonal fora da janela fica indisponivel', () => {
  const r = verificarDisponibilidade({
    produto: { ativo: true, sazonal: true, disponivelDe: '2026-06-01', disponivelAte: '2026-07-31' },
    unidade: { tipoCozinha: 'COMPLETA' },
    estoque: { quantidade: 10 },
    quantidade: 1,
    agora: new Date('2026-11-01'),
  });
  assert.equal(r.ok, false);
});

test('cliente nao pode registrar pedido no canal BALCAO', () => {
  assert.throws(() => validarCanalParaPerfil('BALCAO', 'CLIENTE'), (e) => e.error === 'CANAL_INVALIDO_PARA_PERFIL');
});

test('promocao exclusiva de canal nao vale em outro canal', () => {
  const promo = { ativa: true, inicio: '2026-01-01', fim: '2099-01-01', canalPedido: 'APP', percentualDesconto: 15 };
  assert.equal(validarPromocao(promo, { unidadeId: 1, canalPedido: 'APP' }), 15);
  assert.throws(() => validarPromocao(promo, { unidadeId: 1, canalPedido: 'TOTEM' }), (e) => e.error === 'PROMOCAO_INVALIDA');
});

test('pontos: 1 ponto por real inteiro pago', () => {
  assert.equal(pontosPorPagamento(46.68), 46);
});
