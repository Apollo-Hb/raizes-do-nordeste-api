/**
 * Regra de aplicacao de promocoes/campanhas.
 * Uma promocao se aplica ao pedido quando: esta ativa, dentro da vigencia,
 * e (se restrita) pertence a mesma unidade e/ou ao mesmo canal do pedido.
 * Apenas uma promocao por pedido (sem acumulo de campanhas).
 */
const { Erros } = require('./errors');

function validarPromocao(promocao, { unidadeId, canalPedido, agora = new Date() }) {
  const issue = (msg) =>
    Erros.regraNegocio('PROMOCAO_INVALIDA', 'O codigo promocional nao pode ser aplicado a este pedido.', [
      { field: 'codigoPromocao', issue: msg },
    ]);
  if (!promocao || !promocao.ativa) throw issue('Codigo inexistente ou inativo.');
  if (agora < new Date(promocao.inicio) || agora > new Date(promocao.fim)) throw issue('Promocao fora da vigencia.');
  if (promocao.unidadeId && promocao.unidadeId !== unidadeId) throw issue('Promocao nao vale para esta unidade.');
  if (promocao.canalPedido && promocao.canalPedido !== canalPedido) {
    throw issue(`Promocao exclusiva do canal ${promocao.canalPedido}.`);
  }
  return promocao.percentualDesconto;
}

module.exports = { validarPromocao };
