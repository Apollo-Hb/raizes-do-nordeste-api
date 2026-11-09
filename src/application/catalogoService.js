/**
 * Unidades, produtos, cardapio por unidade e promocoes.
 */
const { Erros } = require('../domain/errors');
const { verificarDisponibilidade } = require('../domain/pedido');
const { produtoDTO, paginar, respostaPaginada, num } = require('./comum');

function criarCatalogoService({ db, audit }) {
  // ---------- Unidades ----------
  async function listarUnidades(filtros) {
    const where = { ativa: true, ...(filtros.uf ? { uf: filtros.uf.toUpperCase() } : {}) };
    const [total, data] = await Promise.all([
      db.unidade.count({ where }),
      db.unidade.findMany({ where, ...paginar(filtros), orderBy: { id: 'asc' } }),
    ]);
    return respostaPaginada(data, total, filtros);
  }

  async function obterUnidade(id) {
    const u = await db.unidade.findUnique({ where: { id } });
    if (!u) throw Erros.naoEncontrado('unidade');
    return u;
  }

  async function criarUnidade(input, ctx) {
    const u = await db.unidade.create({ data: { ...input, uf: input.uf.toUpperCase() } });
    await audit.registrar({ ator: ctx.usuario, acao: 'UNIDADE_CRIADA', entidade: 'Unidade', entidadeId: u.id, contexto: ctx });
    return u;
  }

  /** Cardapio da unidade: produtos vinculados ao estoque local, com preco regional e disponibilidade. */
  async function cardapio(unidadeId, { apenasDisponiveis = false, categoria } = {}) {
    const unidade = await obterUnidade(unidadeId);
    const estoques = await db.estoque.findMany({
      where: { unidadeId, produto: { ativo: true, ...(categoria ? { categoria } : {}) } },
      include: { produto: true },
      orderBy: { produtoId: 'asc' },
    });
    const itens = estoques.map((e) => {
      const r = verificarDisponibilidade({ produto: e.produto, unidade, estoque: e, quantidade: 1 });
      return {
        produtoId: e.produtoId,
        nome: e.produto.nome,
        descricao: e.produto.descricao,
        categoria: e.produto.categoria,
        preco: num(e.precoLocal ?? e.produto.preco),
        disponivel: r.ok,
        ...(r.ok ? {} : { motivoIndisponibilidade: r.issue }),
      };
    });
    return {
      unidade: { id: unidade.id, nome: unidade.nome, tipoCozinha: unidade.tipoCozinha },
      itens: apenasDisponiveis ? itens.filter((i) => i.disponivel) : itens,
    };
  }

  // ---------- Produtos ----------
  async function listarProdutos(filtros) {
    const where = {
      ativo: true,
      ...(filtros.categoria ? { categoria: filtros.categoria } : {}),
      ...(filtros.busca ? { nome: { contains: filtros.busca } } : {}),
    };
    const [total, data] = await Promise.all([
      db.produto.count({ where }),
      db.produto.findMany({ where, ...paginar(filtros), orderBy: { id: 'asc' } }),
    ]);
    return respostaPaginada(data.map(produtoDTO), total, filtros);
  }

  async function obterProduto(id) {
    const p = await db.produto.findUnique({ where: { id } });
    if (!p) throw Erros.naoEncontrado('produto');
    return produtoDTO(p);
  }

  async function criarProduto(input, ctx) {
    const p = await db.produto.create({ data: input });
    await audit.registrar({ ator: ctx.usuario, acao: 'PRODUTO_CRIADO', entidade: 'Produto', entidadeId: p.id, contexto: ctx });
    return produtoDTO(p);
  }

  async function atualizarProduto(id, input, ctx) {
    const atual = await db.produto.findUnique({ where: { id } });
    if (!atual) throw Erros.naoEncontrado('produto');
    const p = await db.produto.update({ where: { id }, data: input });
    await audit.registrar({
      ator: ctx.usuario,
      acao: 'PRODUTO_ATUALIZADO',
      entidade: 'Produto',
      entidadeId: id,
      detalhes: { antes: produtoDTO(atual), depois: produtoDTO(p) },
      contexto: ctx,
    });
    return produtoDTO(p);
  }

  /** Exclusao logica: preserva o historico de pedidos que referenciam o produto. */
  async function desativarProduto(id, ctx) {
    const atual = await db.produto.findUnique({ where: { id } });
    if (!atual) throw Erros.naoEncontrado('produto');
    await db.produto.update({ where: { id }, data: { ativo: false } });
    await audit.registrar({ ator: ctx.usuario, acao: 'PRODUTO_DESATIVADO', entidade: 'Produto', entidadeId: id, contexto: ctx });
  }

  // ---------- Promocoes ----------
  async function listarPromocoes() {
    const agora = new Date();
    const data = await db.promocao.findMany({
      where: { ativa: true, inicio: { lte: agora }, fim: { gte: agora } },
      orderBy: { id: 'asc' },
    });
    return data.map(({ createdAt, ...p }) => p);
  }

  async function criarPromocao(input, ctx) {
    if (new Date(input.fim) <= new Date(input.inicio)) {
      throw Erros.validacao([{ field: 'fim', issue: 'Deve ser posterior a inicio.' }]);
    }
    if (await db.promocao.findUnique({ where: { codigo: input.codigo } })) {
      throw Erros.conflito('PROMOCAO_JA_EXISTE', 'Ja existe promocao com este codigo.');
    }
    if (input.unidadeId) await obterUnidade(input.unidadeId);
    const p = await db.promocao.create({ data: input });
    await audit.registrar({ ator: ctx.usuario, acao: 'PROMOCAO_CRIADA', entidade: 'Promocao', entidadeId: p.id, detalhes: input, contexto: ctx });
    return p;
  }

  return {
    listarUnidades,
    obterUnidade,
    criarUnidade,
    cardapio,
    listarProdutos,
    obterProduto,
    criarProduto,
    atualizarProduto,
    desativarProduto,
    listarPromocoes,
    criarPromocao,
  };
}

module.exports = { criarCatalogoService };
