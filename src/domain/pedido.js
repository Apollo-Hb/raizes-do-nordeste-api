/**
 * Regras de negocio do agregado Pedido (dominio puro, sem dependencia de banco/HTTP).
 */
const { StatusPedido: S, Perfil: P, CanalPedido } = require('./enums');
const { Erros } = require('./errors');
const { paraCentavos, paraReais } = require('./dinheiro');

/**
 * Maquina de estados do pedido.
 * chave = status atual; valor = { proximoStatus: [perfis autorizados] }
 * - PAGO e PAGAMENTO_RECUSADO sao definidos apenas pelo fluxo de pagamento (nao pela rota de status).
 * - CANCELADO e tratado pela rota de cancelamento (devolve estoque e pontos).
 */
const TRANSICOES = {
  [S.PAGO]: { [S.EM_PREPARO]: [P.COZINHA, P.GERENTE, P.ADMIN] },
  [S.EM_PREPARO]: { [S.PRONTO]: [P.COZINHA, P.GERENTE, P.ADMIN] },
  [S.PRONTO]: { [S.ENTREGUE]: [P.ATENDENTE, P.GERENTE, P.ADMIN] },
};

const STATUS_FINAIS = [S.ENTREGUE, S.CANCELADO];
const STATUS_QUE_ACEITAM_PAGAMENTO = [S.AGUARDANDO_PAGAMENTO, S.PAGAMENTO_RECUSADO];

function validarTransicao(statusAtual, novoStatus, perfil) {
  const permitidas = TRANSICOES[statusAtual] || {};
  const perfis = permitidas[novoStatus];
  if (!perfis) {
    throw Erros.conflito(
      'TRANSICAO_STATUS_INVALIDA',
      `Nao e permitido alterar o pedido de ${statusAtual} para ${novoStatus}.`,
      [{ field: 'status', issue: `Transicoes permitidas a partir de ${statusAtual}: ${Object.keys(permitidas).join(', ') || 'nenhuma'}` }],
    );
  }
  if (!perfis.includes(perfil)) {
    throw Erros.acessoNegado(`O perfil ${perfil} nao pode mover pedidos para ${novoStatus}.`);
  }
}

/** Quem pode cancelar e em qual status. Cliente so cancela antes do pagamento aprovado. */
function validarCancelamento(pedido, usuario) {
  if (STATUS_FINAIS.includes(pedido.status)) {
    throw Erros.conflito('PEDIDO_FINALIZADO', `Pedido em status ${pedido.status} nao pode ser cancelado.`);
  }
  const ehGestao = [P.GERENTE, P.ADMIN].includes(usuario.perfil);
  if (!ehGestao && !STATUS_QUE_ACEITAM_PAGAMENTO.includes(pedido.status)) {
    throw Erros.conflito(
      'CANCELAMENTO_NAO_PERMITIDO',
      'Pedido ja pago so pode ser cancelado por GERENTE ou ADMIN (gera estorno).',
    );
  }
}

/** Regra de canal: BALCAO e operado pela equipe da loja; os demais canais sao autoatendimento do cliente. */
function validarCanalParaPerfil(canal, perfil) {
  if (canal === CanalPedido.BALCAO && perfil === P.CLIENTE) {
    throw Erros.regraNegocio('CANAL_INVALIDO_PARA_PERFIL', 'Pedidos no canal BALCAO sao registrados por um atendente.', [
      { field: 'canalPedido', issue: 'Clientes podem usar APP, TOTEM, PICKUP ou WEB.' },
    ]);
  }
  if (canal !== CanalPedido.BALCAO && [P.ATENDENTE].includes(perfil)) {
    throw Erros.regraNegocio('CANAL_INVALIDO_PARA_PERFIL', 'Atendentes registram pedidos apenas no canal BALCAO.', [
      { field: 'canalPedido', issue: 'Use BALCAO.' },
    ]);
  }
}

/** Disponibilidade de um produto em uma unidade (cardapio por unidade). */
function verificarDisponibilidade({ produto, unidade, estoque, quantidade, agora = new Date() }) {
  if (!produto.ativo) return { ok: false, issue: 'Produto inativo.' };
  if (produto.exigeCozinhaCompleta && unidade.tipoCozinha !== 'COMPLETA') {
    return { ok: false, issue: 'Produto exige cozinha completa e a unidade opera em formato reduzido.' };
  }
  if (produto.sazonal) {
    const de = produto.disponivelDe ? new Date(produto.disponivelDe) : null;
    const ate = produto.disponivelAte ? new Date(produto.disponivelAte) : null;
    if ((de && agora < de) || (ate && agora > ate)) return { ok: false, issue: 'Produto sazonal fora do periodo de venda.' };
  }
  if (!estoque) return { ok: false, issue: 'Produto nao faz parte do cardapio desta unidade.' };
  if (estoque.quantidade < quantidade) {
    return { ok: false, issue: `Disponivel: ${estoque.quantidade}`, semEstoque: true };
  }
  return { ok: true };
}

/**
 * Calcula os totais do pedido.
 * Ordem: subtotal -> desconto de promocao (%) -> desconto por pontos (limitado a 50% do restante).
 */
function calcularTotais({ itens, percentualPromocao = 0, pontosSolicitados = 0, valorCentavosPorPonto = 10 }) {
  const itensCalc = itens.map((i) => {
    const unit = paraCentavos(i.precoUnitario);
    return { ...i, precoUnitarioCentavos: unit, subtotalCentavos: unit * i.quantidade };
  });
  const subtotal = itensCalc.reduce((acc, i) => acc + i.subtotalCentavos, 0);
  const descontoPromocao = Math.floor((subtotal * percentualPromocao) / 100);
  const aposPromocao = subtotal - descontoPromocao;
  const maxDescontoPontos = Math.floor(aposPromocao / 2);
  const pontosUsaveis = Math.min(pontosSolicitados, Math.floor(maxDescontoPontos / valorCentavosPorPonto));
  const descontoPontos = pontosUsaveis * valorCentavosPorPonto;
  const total = aposPromocao - descontoPontos;
  return {
    itens: itensCalc.map((i) => ({
      produtoId: i.produtoId,
      quantidade: i.quantidade,
      precoUnitario: paraReais(i.precoUnitarioCentavos),
      subtotal: paraReais(i.subtotalCentavos),
    })),
    subtotal: paraReais(subtotal),
    descontoPromocao: paraReais(descontoPromocao),
    descontoPontos: paraReais(descontoPontos),
    pontosResgatados: pontosUsaveis,
    total: paraReais(total),
  };
}

module.exports = {
  TRANSICOES,
  STATUS_FINAIS,
  STATUS_QUE_ACEITAM_PAGAMENTO,
  validarTransicao,
  validarCancelamento,
  validarCanalParaPerfil,
  verificarDisponibilidade,
  calcularTotais,
};
