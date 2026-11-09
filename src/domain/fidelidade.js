/**
 * Programa de fidelizacao "Raizes+".
 * - Acumulo: 1 ponto a cada R$ 1,00 pago (parte inteira do total), somente com consentimento ativo.
 * - Resgate: cada ponto vale R$ 0,10; o desconto por pontos e limitado a 50% do valor do pedido.
 * - Pontos acumulados so sao creditados apos pagamento APROVADO; cancelamento estorna.
 */
const REGRAS_FIDELIDADE = Object.freeze({
  pontosPorReal: 1,
  valorCentavosPorPonto: 10,
  limiteDescontoPercentual: 50,
  versaoTermo: 'v1.0-2026',
});

function pontosPorPagamento(totalReais) {
  return Math.floor(Number(totalReais)) * REGRAS_FIDELIDADE.pontosPorReal;
}

module.exports = { REGRAS_FIDELIDADE, pontosPorPagamento };
