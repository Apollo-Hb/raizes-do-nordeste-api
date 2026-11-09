/**
 * Casos de uso do fluxo critico de pedidos:
 * criar (valida canal, itens, cardapio/estoque, promocao e pontos; reserva estoque),
 * listar/consultar (filtro por canal), atualizar status (maquina de estados) e cancelar.
 */
const { Erros } = require('../domain/errors');
const { Perfil, StatusPedido, TipoMovimentacao } = require('../domain/enums');
const {
  validarCanalParaPerfil,
  verificarDisponibilidade,
  calcularTotais,
  validarTransicao,
  validarCancelamento,
} = require('../domain/pedido');
const { validarPromocao } = require('../domain/promocao');
const { REGRAS_FIDELIDADE } = require('../domain/fidelidade');
const { pedidoDTO, paginar, respostaPaginada, podeVerPedido, exigirAcessoUnidade, ehFuncionario } = require('./comum');

const INCLUDE_COMPLETO = {
  itens: { include: { produto: { select: { nome: true } } } },
  promocao: { select: { codigo: true } },
  historico: { orderBy: { id: 'asc' } },
  pagamentos: { orderBy: { id: 'asc' } },
};

function criarPedidoService({ db, audit, fidelidade, gateway }) {
  async function buscarVisivel(id, usuario, include = INCLUDE_COMPLETO) {
    const pedido = await db.pedido.findUnique({ where: { id }, include });
    // Para terceiros respondemos 404 (nao revela a existencia de pedidos de outros clientes).
    if (!pedido || !podeVerPedido(usuario, pedido)) throw Erros.naoEncontrado('pedido');
    return pedido;
  }

  /** Agrupa itens repetidos do mesmo produto. */
  function consolidarItens(itens) {
    const mapa = new Map();
    itens.forEach((i, idx) => {
      const atual = mapa.get(i.produtoId);
      if (atual) atual.quantidade += i.quantidade;
      else mapa.set(i.produtoId, { produtoId: i.produtoId, quantidade: i.quantidade, idx });
    });
    return [...mapa.values()];
  }

  async function criar(input, ctx, idempotencyKey) {
    const ator = ctx.usuario;

    // Idempotencia: reenvio com a mesma chave (ex.: totem perdeu a conexao) devolve o mesmo pedido.
    if (idempotencyKey) {
      const existente = await db.pedido.findUnique({ where: { idempotencyKey }, include: INCLUDE_COMPLETO });
      if (existente) {
        if (!podeVerPedido(ator, existente)) {
          throw Erros.conflito('IDEMPOTENCY_KEY_EM_USO', 'Idempotency-Key ja utilizada por outra requisicao.');
        }
        return { pedido: pedidoDTO(existente), reutilizado: true };
      }
    }

    validarCanalParaPerfil(input.canalPedido, ator.perfil);

    // Quem e o cliente do pedido
    let clienteId = null;
    if (ator.perfil === Perfil.CLIENTE) {
      if (input.clienteId && input.clienteId !== ator.id) {
        throw Erros.acessoNegado('Cliente so pode criar pedidos para si mesmo.');
      }
      clienteId = ator.id;
    } else if (input.clienteId) {
      const cliente = await db.usuario.findUnique({ where: { id: input.clienteId } });
      if (!cliente || cliente.perfil !== Perfil.CLIENTE || !cliente.ativo) throw Erros.naoEncontrado('cliente');
      clienteId = cliente.id;
    }

    const unidade = await db.unidade.findUnique({ where: { id: input.unidadeId } });
    if (!unidade || !unidade.ativa) {
      throw Erros.naoEncontrado('unidade', [{ field: 'unidadeId', issue: `Unidade ${input.unidadeId} inexistente ou inativa.` }]);
    }
    if (ehFuncionario(ator)) exigirAcessoUnidade(ator, unidade.id);

    // Validacao de itens contra cardapio e estoque da unidade
    const itens = consolidarItens(input.itens);
    const produtos = await db.produto.findMany({ where: { id: { in: itens.map((i) => i.produtoId) } } });
    const estoques = await db.estoque.findMany({ where: { unidadeId: unidade.id, produtoId: { in: itens.map((i) => i.produtoId) } } });

    const inexistentes = [];
    const indisponiveis = [];
    const semEstoque = [];
    const itensPrecificados = [];
    for (const item of itens) {
      const field = `itens[${item.idx}]`;
      const produto = produtos.find((p) => p.id === item.produtoId);
      if (!produto) {
        inexistentes.push({ field: `${field}.produtoId`, issue: `Produto ${item.produtoId} nao encontrado.` });
        continue;
      }
      const estoque = estoques.find((e) => e.produtoId === item.produtoId);
      const r = verificarDisponibilidade({ produto, unidade, estoque, quantidade: item.quantidade });
      if (!r.ok) {
        (r.semEstoque ? semEstoque : indisponiveis).push({
          field: r.semEstoque ? `${field}.quantidade` : `${field}.produtoId`,
          issue: r.issue,
        });
        continue;
      }
      itensPrecificados.push({ ...item, precoUnitario: estoque.precoLocal ?? produto.preco });
    }
    if (inexistentes.length) throw Erros.naoEncontrado('produto', inexistentes);
    if (indisponiveis.length) {
      throw Erros.regraNegocio('PRODUTO_INDISPONIVEL', 'Um ou mais produtos nao estao disponiveis nesta unidade.', indisponiveis);
    }
    if (semEstoque.length) {
      throw Erros.conflito('ESTOQUE_INSUFICIENTE', 'Nao ha quantidade suficiente para um ou mais itens.', semEstoque);
    }

    // Promocao / campanha
    let promocao = null;
    let percentual = 0;
    if (input.codigoPromocao) {
      promocao = await db.promocao.findUnique({ where: { codigo: input.codigoPromocao.toUpperCase() } });
      percentual = validarPromocao(promocao, { unidadeId: unidade.id, canalPedido: input.canalPedido });
    }

    // Resgate de pontos (exige cliente identificado + consentimento + saldo)
    const pontosSolicitados = input.usarPontos || 0;
    if (pontosSolicitados > 0) {
      if (!clienteId) {
        throw Erros.regraNegocio('CLIENTE_NAO_IDENTIFICADO', 'Resgate de pontos exige cliente identificado.', [
          { field: 'clienteId', issue: 'Obrigatorio para usarPontos.' },
        ]);
      }
      if (!(await fidelidade.temConsentimento(clienteId))) {
        throw Erros.regraNegocio('CONSENTIMENTO_NECESSARIO', 'Cliente nao aderiu ao programa de fidelidade (consentimento LGPD).', [
          { field: 'usarPontos', issue: 'Conceda o consentimento em PUT /usuarios/me/consentimentos.' },
        ]);
      }
      const saldo = await fidelidade.saldoPontos(clienteId);
      if (saldo < pontosSolicitados) {
        throw Erros.regraNegocio('SALDO_PONTOS_INSUFICIENTE', 'Saldo de pontos insuficiente.', [
          { field: 'usarPontos', issue: `Saldo atual: ${saldo}` },
        ]);
      }
    }

    const totais = calcularTotais({
      itens: itensPrecificados,
      percentualPromocao: percentual,
      pontosSolicitados,
      valorCentavosPorPonto: REGRAS_FIDELIDADE.valorCentavosPorPonto,
    });

    const pedido = await db.$transaction(async (tx) => {
      // Reserva de estoque com UPDATE condicional (protege contra venda acima do saldo em concorrencia).
      for (const item of totais.itens) {
        const r = await tx.estoque.updateMany({
          where: { unidadeId: unidade.id, produtoId: item.produtoId, quantidade: { gte: item.quantidade } },
          data: { quantidade: { decrement: item.quantidade } },
        });
        if (r.count === 0) {
          throw Erros.conflito('ESTOQUE_INSUFICIENTE', 'Estoque alterado durante o pedido. Tente novamente.', [
            { field: 'itens', issue: `Produto ${item.produtoId} sem saldo.` },
          ]);
        }
      }

      const criado = await tx.pedido.create({
        data: {
          clienteId,
          atendenteId: ator.perfil === Perfil.CLIENTE ? null : ator.id,
          unidadeId: unidade.id,
          canalPedido: input.canalPedido,
          formaPagamento: input.formaPagamento,
          subtotal: totais.subtotal,
          descontoPromocao: totais.descontoPromocao,
          descontoPontos: totais.descontoPontos,
          pontosResgatados: totais.pontosResgatados,
          total: totais.total,
          promocaoId: promocao?.id ?? null,
          observacao: input.observacao,
          idempotencyKey: idempotencyKey || null,
          itens: { create: totais.itens },
          historico: { create: { statusDe: null, statusPara: StatusPedido.AGUARDANDO_PAGAMENTO, usuarioId: ator.id } },
        },
      });

      for (const item of totais.itens) {
        const e = await tx.estoque.findUnique({ where: { unidadeId_produtoId: { unidadeId: unidade.id, produtoId: item.produtoId } } });
        await tx.movimentacaoEstoque.create({
          data: {
            unidadeId: unidade.id,
            produtoId: item.produtoId,
            tipo: TipoMovimentacao.RESERVA_PEDIDO,
            quantidade: item.quantidade,
            saldoApos: e.quantidade,
            pedidoId: criado.id,
            usuarioId: ator.id,
            motivo: `Reserva do pedido #${criado.id}`,
          },
        });
      }

      if (totais.pontosResgatados > 0) {
        await tx.transacaoFidelidade.create({
          data: {
            usuarioId: clienteId,
            pedidoId: criado.id,
            tipo: 'RESGATE',
            pontos: -totais.pontosResgatados,
            descricao: `Resgate no pedido #${criado.id}`,
          },
        });
      }

      await audit.registrar({
        db: tx,
        ator,
        acao: 'PEDIDO_CRIADO',
        entidade: 'Pedido',
        entidadeId: criado.id,
        detalhes: { canalPedido: input.canalPedido, unidadeId: unidade.id, total: totais.total, itens: totais.itens.length },
        contexto: ctx,
      });

      return tx.pedido.findUnique({ where: { id: criado.id }, include: INCLUDE_COMPLETO });
    });

    return { pedido: pedidoDTO(pedido), reutilizado: false };
  }

  async function listar(filtros, ctx) {
    const u = ctx.usuario;
    const where = {
      ...(filtros.canalPedido ? { canalPedido: filtros.canalPedido } : {}),
      ...(filtros.status ? { status: filtros.status } : {}),
      ...(filtros.unidadeId ? { unidadeId: filtros.unidadeId } : {}),
      ...(filtros.dataInicio || filtros.dataFim
        ? { createdAt: { ...(filtros.dataInicio ? { gte: filtros.dataInicio } : {}), ...(filtros.dataFim ? { lte: filtros.dataFim } : {}) } }
        : {}),
    };
    // Escopo de visibilidade por perfil
    if (u.perfil === Perfil.CLIENTE) where.clienteId = u.id;
    else if (u.perfil !== Perfil.ADMIN) {
      if (filtros.unidadeId && filtros.unidadeId !== u.unidadeId) exigirAcessoUnidade(u, filtros.unidadeId);
      where.unidadeId = u.unidadeId;
    }

    const [total, data] = await Promise.all([
      db.pedido.count({ where }),
      db.pedido.findMany({
        where,
        include: { itens: { include: { produto: { select: { nome: true } } } }, promocao: { select: { codigo: true } } },
        ...paginar(filtros),
        orderBy: { id: filtros.ordem === 'asc' ? 'asc' : 'desc' },
      }),
    ]);
    return respostaPaginada(data.map(pedidoDTO), total, filtros);
  }

  async function obter(id, ctx) {
    return pedidoDTO(await buscarVisivel(id, ctx.usuario));
  }

  async function atualizarStatus(id, { status, observacao }, ctx) {
    const pedido = await buscarVisivel(id, ctx.usuario, {});
    if (ctx.usuario.perfil === Perfil.CLIENTE) throw Erros.acessoNegado('Clientes nao alteram status de pedidos.');
    validarTransicao(pedido.status, status, ctx.usuario.perfil);

    await db.$transaction(async (tx) => {
      // Controle otimista: so atualiza se o status nao mudou desde a leitura.
      const r = await tx.pedido.updateMany({ where: { id, status: pedido.status }, data: { status } });
      if (r.count === 0) throw Erros.conflito('PEDIDO_ALTERADO', 'O pedido foi alterado por outra operacao. Recarregue e tente novamente.');
      await tx.historicoStatusPedido.create({
        data: { pedidoId: id, statusDe: pedido.status, statusPara: status, usuarioId: ctx.usuario.id, observacao },
      });
      await audit.registrar({
        db: tx,
        ator: ctx.usuario,
        acao: 'PEDIDO_STATUS_ALTERADO',
        entidade: 'Pedido',
        entidadeId: id,
        detalhes: { de: pedido.status, para: status, observacao },
        contexto: ctx,
      });
    });
    return obter(id, ctx);
  }

  async function cancelar(id, { motivo }, ctx) {
    const pedido = await buscarVisivel(id, ctx.usuario, { itens: true, pagamentos: true, transacoesFidelidade: true });
    if ([Perfil.COZINHA].includes(ctx.usuario.perfil)) throw Erros.acessoNegado('Perfil COZINHA nao cancela pedidos.');
    validarCancelamento(pedido, ctx.usuario);

    const pagamentoAprovado = pedido.pagamentos.find((p) => p.status === 'APROVADO');
    let estorno = null;
    if (pagamentoAprovado) {
      estorno = await gateway.estornar({ transacaoId: pagamentoAprovado.transacaoExternaId, valor: Number(pagamentoAprovado.valor) });
    }

    await db.$transaction(async (tx) => {
      const r = await tx.pedido.updateMany({
        where: { id, status: pedido.status },
        data: { status: StatusPedido.CANCELADO, motivoCancelamento: motivo },
      });
      if (r.count === 0) throw Erros.conflito('PEDIDO_ALTERADO', 'O pedido foi alterado por outra operacao. Recarregue e tente novamente.');

      // Devolve o estoque reservado
      for (const item of pedido.itens) {
        const e = await tx.estoque.update({
          where: { unidadeId_produtoId: { unidadeId: pedido.unidadeId, produtoId: item.produtoId } },
          data: { quantidade: { increment: item.quantidade } },
        });
        await tx.movimentacaoEstoque.create({
          data: {
            unidadeId: pedido.unidadeId,
            produtoId: item.produtoId,
            tipo: TipoMovimentacao.ESTORNO_PEDIDO,
            quantidade: item.quantidade,
            saldoApos: e.quantidade,
            pedidoId: id,
            usuarioId: ctx.usuario.id,
            motivo: `Cancelamento do pedido #${id}`,
          },
        });
      }

      // Estorna pontos (devolve resgatados e retira acumulados)
      const saldoPontosPedido = pedido.transacoesFidelidade.reduce((acc, t) => acc + t.pontos, 0);
      if (saldoPontosPedido !== 0 && pedido.clienteId) {
        await tx.transacaoFidelidade.create({
          data: {
            usuarioId: pedido.clienteId,
            pedidoId: id,
            tipo: 'ESTORNO',
            pontos: -saldoPontosPedido,
            descricao: `Estorno de pontos do pedido #${id} cancelado`,
          },
        });
      }

      if (pagamentoAprovado) {
        await tx.pagamento.create({
          data: {
            pedidoId: id,
            status: 'ESTORNADO',
            metodo: pagamentoAprovado.metodo,
            valor: pagamentoAprovado.valor,
            tentativa: pedido.pagamentos.length + 1,
            transacaoExternaId: pagamentoAprovado.transacaoExternaId,
            codigoRetorno: 'ESTORNADO',
            mensagemRetorno: 'Estorno solicitado ao gateway.',
            payloadResposta: JSON.stringify(estorno),
          },
        });
      }

      await tx.historicoStatusPedido.create({
        data: { pedidoId: id, statusDe: pedido.status, statusPara: StatusPedido.CANCELADO, usuarioId: ctx.usuario.id, observacao: motivo },
      });
      await audit.registrar({
        db: tx,
        ator: ctx.usuario,
        acao: 'PEDIDO_CANCELADO',
        entidade: 'Pedido',
        entidadeId: id,
        detalhes: { statusAnterior: pedido.status, motivo, estorno: Boolean(pagamentoAprovado) },
        contexto: ctx,
      });
    });
    return obter(id, ctx);
  }

  return { criar, listar, obter, atualizarStatus, cancelar, buscarVisivel };
}

module.exports = { criarPedidoService };
