/**
 * Visao da matriz: auditoria e relatorios consolidados de vendas (por canal, unidade e produto).
 */
const { Perfil } = require('../domain/enums');
const { paginar, respostaPaginada, num, exigirAcessoUnidade } = require('./comum');

const STATUS_VENDA = ['PAGO', 'EM_PREPARO', 'PRONTO', 'ENTREGUE'];

function criarGestaoService({ db }) {
  async function listarAuditoria(filtros) {
    const where = {
      ...(filtros.acao ? { acao: filtros.acao } : {}),
      ...(filtros.entidade ? { entidade: filtros.entidade } : {}),
      ...(filtros.entidadeId ? { entidadeId: String(filtros.entidadeId) } : {}),
      ...(filtros.usuarioId ? { usuarioId: filtros.usuarioId } : {}),
    };
    const [total, data] = await Promise.all([
      db.auditLog.count({ where }),
      db.auditLog.findMany({ where, ...paginar(filtros), orderBy: { id: 'desc' } }),
    ]);
    return respostaPaginada(
      data.map((a) => ({ ...a, detalhes: a.detalhes ? JSON.parse(a.detalhes) : null })),
      total,
      filtros,
    );
  }

  async function relatorioVendas(filtros, ctx) {
    let unidadeId = filtros.unidadeId;
    if (ctx.usuario.perfil !== Perfil.ADMIN) {
      unidadeId = unidadeId || ctx.usuario.unidadeId;
      exigirAcessoUnidade(ctx.usuario, unidadeId);
    }
    const where = {
      status: { in: STATUS_VENDA },
      ...(unidadeId ? { unidadeId } : {}),
      ...(filtros.dataInicio || filtros.dataFim
        ? { createdAt: { ...(filtros.dataInicio ? { gte: filtros.dataInicio } : {}), ...(filtros.dataFim ? { lte: filtros.dataFim } : {}) } }
        : {}),
    };
    const [porCanal, porUnidade, porProduto, unidades] = await Promise.all([
      db.pedido.groupBy({ by: ['canalPedido'], where, _count: { _all: true }, _sum: { total: true } }),
      db.pedido.groupBy({ by: ['unidadeId'], where, _count: { _all: true }, _sum: { total: true } }),
      db.itemPedido.groupBy({ by: ['produtoId'], where: { pedido: where }, _sum: { quantidade: true, subtotal: true } }),
      db.unidade.findMany({ select: { id: true, nome: true, uf: true } }),
    ]);
    const produtos = await db.produto.findMany({ where: { id: { in: porProduto.map((p) => p.produtoId) } }, select: { id: true, nome: true } });
    const totalGeral = porCanal.reduce((a, c) => a + num(c._sum.total || 0), 0);
    return {
      filtros: { unidadeId: unidadeId ?? null, dataInicio: filtros.dataInicio ?? null, dataFim: filtros.dataFim ?? null },
      totalPedidos: porCanal.reduce((a, c) => a + c._count._all, 0),
      faturamento: Number(totalGeral.toFixed(2)),
      porCanal: porCanal.map((c) => ({ canalPedido: c.canalPedido, pedidos: c._count._all, faturamento: num(c._sum.total) })),
      porUnidade: porUnidade.map((u) => {
        const un = unidades.find((x) => x.id === u.unidadeId);
        return { unidadeId: u.unidadeId, nome: un?.nome, uf: un?.uf, pedidos: u._count._all, faturamento: num(u._sum.total) };
      }),
      produtosMaisVendidos: porProduto
        .map((p) => ({
          produtoId: p.produtoId,
          nome: produtos.find((x) => x.id === p.produtoId)?.nome,
          quantidade: p._sum.quantidade,
          faturamento: num(p._sum.subtotal),
        }))
        .sort((a, b) => b.quantidade - a.quantidade),
    };
  }

  return { listarAuditoria, relatorioVendas };
}

module.exports = { criarGestaoService };
