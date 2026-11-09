/**
 * Controle de estoque por unidade (entrada/saida e consulta de saldo).
 * A baixa usa UPDATE condicional (quantidade >= x) para ser segura sob concorrencia em horario de pico.
 */
const { Erros } = require('../domain/errors');
const { TipoMovimentacao } = require('../domain/enums');
const { exigirAcessoUnidade, paginar, respostaPaginada, num } = require('./comum');

function criarEstoqueService({ db, audit }) {
  async function consultarSaldo(unidadeId, ctx) {
    const unidade = await db.unidade.findUnique({ where: { id: unidadeId } });
    if (!unidade) throw Erros.naoEncontrado('unidade');
    exigirAcessoUnidade(ctx.usuario, unidadeId);
    const itens = await db.estoque.findMany({ where: { unidadeId }, include: { produto: true }, orderBy: { produtoId: 'asc' } });
    return {
      unidadeId,
      itens: itens.map((e) => ({
        produtoId: e.produtoId,
        nome: e.produto.nome,
        quantidade: e.quantidade,
        precoLocal: num(e.precoLocal),
        atualizadoEm: e.updatedAt,
      })),
    };
  }

  async function movimentar({ unidadeId, produtoId, tipo, quantidade, motivo }, ctx) {
    const [unidade, produto] = await Promise.all([
      db.unidade.findUnique({ where: { id: unidadeId } }),
      db.produto.findUnique({ where: { id: produtoId } }),
    ]);
    if (!unidade) throw Erros.naoEncontrado('unidade');
    if (!produto) throw Erros.naoEncontrado('produto');
    exigirAcessoUnidade(ctx.usuario, unidadeId);

    return db.$transaction(async (tx) => {
      let saldo;
      if (tipo === TipoMovimentacao.ENTRADA) {
        const e = await tx.estoque.upsert({
          where: { unidadeId_produtoId: { unidadeId, produtoId } },
          create: { unidadeId, produtoId, quantidade },
          update: { quantidade: { increment: quantidade } },
        });
        saldo = e.quantidade;
      } else {
        const r = await tx.estoque.updateMany({
          where: { unidadeId, produtoId, quantidade: { gte: quantidade } },
          data: { quantidade: { decrement: quantidade } },
        });
        const e = await tx.estoque.findUnique({ where: { unidadeId_produtoId: { unidadeId, produtoId } } });
        if (r.count === 0) {
          throw Erros.conflito('ESTOQUE_INSUFICIENTE', 'Saida maior que o saldo disponivel.', [
            { field: 'quantidade', issue: `Disponivel: ${e?.quantidade ?? 0}` },
          ]);
        }
        saldo = e.quantidade;
      }
      const mov = await tx.movimentacaoEstoque.create({
        data: { unidadeId, produtoId, tipo, quantidade, saldoApos: saldo, motivo, usuarioId: ctx.usuario.id },
      });
      await audit.registrar({
        db: tx,
        ator: ctx.usuario,
        acao: 'ESTOQUE_MOVIMENTADO',
        entidade: 'Estoque',
        entidadeId: `${unidadeId}:${produtoId}`,
        detalhes: { tipo, quantidade, saldoApos: saldo, motivo },
        contexto: ctx,
      });
      return { movimentacaoId: mov.id, unidadeId, produtoId, tipo, quantidade, saldoAtual: saldo, motivo, createdAt: mov.createdAt };
    });
  }

  async function listarMovimentacoes(filtros, ctx) {
    exigirAcessoUnidade(ctx.usuario, filtros.unidadeId);
    const where = { unidadeId: filtros.unidadeId, ...(filtros.produtoId ? { produtoId: filtros.produtoId } : {}) };
    const [total, data] = await Promise.all([
      db.movimentacaoEstoque.count({ where }),
      db.movimentacaoEstoque.findMany({ where, ...paginar(filtros), orderBy: { id: 'desc' } }),
    ]);
    return respostaPaginada(data, total, filtros);
  }

  return { consultarSaldo, movimentar, listarMovimentacoes };
}

module.exports = { criarEstoqueService };
