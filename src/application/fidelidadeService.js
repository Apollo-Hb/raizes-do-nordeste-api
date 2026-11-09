/**
 * Programa de fidelizacao: saldo, extrato e verificacao de consentimento.
 */
const { FinalidadeConsentimento } = require('../domain/enums');
const { REGRAS_FIDELIDADE } = require('../domain/fidelidade');
const { paginar, respostaPaginada } = require('./comum');

function criarFidelidadeService({ db }) {
  async function temConsentimento(usuarioId, client = db) {
    const ultimo = await client.consentimento.findFirst({
      where: { usuarioId, finalidade: FinalidadeConsentimento.FIDELIDADE },
      orderBy: { id: 'desc' },
    });
    return Boolean(ultimo?.concedido);
  }

  async function saldoPontos(usuarioId, client = db) {
    const r = await client.transacaoFidelidade.aggregate({ where: { usuarioId }, _sum: { pontos: true } });
    return r._sum.pontos || 0;
  }

  async function saldo(ctx) {
    const [pontos, consentimento] = await Promise.all([saldoPontos(ctx.usuario.id), temConsentimento(ctx.usuario.id)]);
    return {
      usuarioId: ctx.usuario.id,
      consentimentoAtivo: consentimento,
      saldoPontos: pontos,
      equivalenteEmReais: Number(((pontos * REGRAS_FIDELIDADE.valorCentavosPorPonto) / 100).toFixed(2)),
      regras: {
        acumulo: `${REGRAS_FIDELIDADE.pontosPorReal} ponto por R$ 1,00 pago`,
        resgate: `1 ponto = R$ ${(REGRAS_FIDELIDADE.valorCentavosPorPonto / 100).toFixed(2)}; desconto maximo de ${REGRAS_FIDELIDADE.limiteDescontoPercentual}% do pedido`,
      },
    };
  }

  async function extrato(ctx, filtros) {
    const where = { usuarioId: ctx.usuario.id };
    const [total, data] = await Promise.all([
      db.transacaoFidelidade.count({ where }),
      db.transacaoFidelidade.findMany({ where, ...paginar(filtros), orderBy: { id: 'desc' } }),
    ]);
    return respostaPaginada(
      data.map((t) => ({ id: t.id, tipo: t.tipo, pontos: t.pontos, pedidoId: t.pedidoId, descricao: t.descricao, em: t.createdAt })),
      total,
      filtros,
    );
  }

  return { temConsentimento, saldoPontos, saldo, extrato };
}

module.exports = { criarFidelidadeService };
