/**
 * Caso de uso "Solicitar pagamento" (integracao desacoplada com gateway externo - mock).
 * Fluxo: valida pedido -> chama o gateway (com retry/backoff) -> registra a tentativa ->
 *        atualiza o status do pedido -> credita pontos (se houver consentimento) -> audita.
 */
const { Erros } = require('../domain/errors');
const { StatusPedido, StatusPagamento } = require('../domain/enums');
const { STATUS_QUE_ACEITAM_PAGAMENTO } = require('../domain/pedido');
const { pontosPorPagamento } = require('../domain/fidelidade');
const { pagamentoDTO, num } = require('./comum');
const { GatewayIndisponivelError } = require('./portas');

function criarPagamentoService({ db, audit, gateway, fidelidade, pedidos, maxTentativas = 3, backoffBaseMs = 50 }) {
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Tolerancia a falhas: ate N chamadas com backoff exponencial antes de desistir. */
  async function chamarGatewayComRetry(req) {
    let ultimoErro;
    for (let i = 0; i < maxTentativas; i++) {
      try {
        return { resposta: await gateway.solicitarPagamento(req), chamadas: i + 1 };
      } catch (e) {
        if (!(e instanceof GatewayIndisponivelError)) throw e;
        ultimoErro = e;
        if (i < maxTentativas - 1) await esperar(backoffBaseMs * 2 ** i);
      }
    }
    ultimoErro.chamadas = maxTentativas;
    throw ultimoErro;
  }

  async function solicitar({ pedidoId, metodo, tokenPagamento }, ctx, idempotencyKey) {
    if (idempotencyKey) {
      const existente = await db.pagamento.findUnique({ where: { idempotencyKey } });
      if (existente) {
        const pedido = await pedidos.buscarVisivel(existente.pedidoId, ctx.usuario, {});
        return { pagamento: pagamentoDTO(existente), pedido: { pedidoId: pedido.id, status: pedido.status }, reutilizado: true };
      }
    }

    const pedido = await pedidos.buscarVisivel(pedidoId, ctx.usuario, { pagamentos: true });
    if (pedido.status === StatusPedido.CANCELADO) {
      throw Erros.conflito('PEDIDO_CANCELADO', 'Pedido cancelado nao pode ser pago.');
    }
    if (!STATUS_QUE_ACEITAM_PAGAMENTO.includes(pedido.status)) {
      throw Erros.conflito('PEDIDO_JA_PAGO', `Pedido em status ${pedido.status} ja possui pagamento aprovado.`);
    }

    const metodoFinal = metodo || pedido.formaPagamento;
    const tentativa = pedido.pagamentos.length + 1;
    const valor = num(pedido.total);
    const requisicaoGateway = {
      referencia: `pedido-${pedido.id}-tentativa-${tentativa}`,
      valor,
      metodo: metodoFinal,
      tokenPagamento,
      idempotencyKey: idempotencyKey || `pedido-${pedido.id}-tentativa-${tentativa}`,
    };

    let resultado;
    try {
      resultado = await chamarGatewayComRetry(requisicaoGateway);
    } catch (e) {
      // Falha de comunicacao: registra a tentativa com status ERRO; o pedido continua aguardando pagamento.
      const reg = await db.pagamento.create({
        data: {
          pedidoId: pedido.id,
          status: StatusPagamento.ERRO,
          metodo: metodoFinal,
          valor,
          tentativa,
          codigoRetorno: 'GATEWAY_TIMEOUT',
          mensagemRetorno: e.message,
          // Sem idempotencyKey: um reenvio com a mesma chave deve tentar novamente.
        },
      });
      await audit.registrar({
        ator: ctx.usuario,
        acao: 'PAGAMENTO_FALHA_GATEWAY',
        entidade: 'Pagamento',
        entidadeId: reg.id,
        detalhes: { pedidoId: pedido.id, chamadas: e.chamadas },
        contexto: ctx,
      });
      throw Erros.gatewayIndisponivel(
        `Gateway de pagamento indisponivel apos ${e.chamadas} tentativas. O pedido segue aguardando pagamento; tente novamente.`,
      );
    }

    const { resposta, chamadas } = resultado;
    const aprovado = resposta.status === StatusPagamento.APROVADO;
    const novoStatusPedido = aprovado ? StatusPedido.PAGO : StatusPedido.PAGAMENTO_RECUSADO;

    const saida = await db.$transaction(async (tx) => {
      const pagamento = await tx.pagamento.create({
        data: {
          pedidoId: pedido.id,
          status: resposta.status,
          metodo: metodoFinal,
          valor,
          tentativa,
          transacaoExternaId: resposta.transacaoId,
          codigoRetorno: resposta.codigo,
          mensagemRetorno: resposta.mensagem,
          payloadResposta: JSON.stringify(resposta.payload),
          idempotencyKey: idempotencyKey || null,
        },
      });
      const r = await tx.pedido.updateMany({ where: { id: pedido.id, status: pedido.status }, data: { status: novoStatusPedido } });
      if (r.count === 0) throw Erros.conflito('PEDIDO_ALTERADO', 'O pedido foi alterado durante o pagamento.');
      await tx.historicoStatusPedido.create({
        data: {
          pedidoId: pedido.id,
          statusDe: pedido.status,
          statusPara: novoStatusPedido,
          usuarioId: ctx.usuario.id,
          observacao: `Retorno do gateway: ${resposta.codigo}`,
        },
      });

      let pontosCreditados = 0;
      if (aprovado && pedido.clienteId && (await fidelidade.temConsentimento(pedido.clienteId, tx))) {
        pontosCreditados = pontosPorPagamento(valor);
        if (pontosCreditados > 0) {
          await tx.transacaoFidelidade.create({
            data: {
              usuarioId: pedido.clienteId,
              pedidoId: pedido.id,
              tipo: 'ACUMULO',
              pontos: pontosCreditados,
              descricao: `Pontos do pedido #${pedido.id}`,
            },
          });
        }
      }

      await audit.registrar({
        db: tx,
        ator: ctx.usuario,
        acao: aprovado ? 'PAGAMENTO_APROVADO' : 'PAGAMENTO_RECUSADO',
        entidade: 'Pagamento',
        entidadeId: pagamento.id,
        detalhes: { pedidoId: pedido.id, valor, metodo: metodoFinal, codigo: resposta.codigo, chamadasGateway: chamadas },
        contexto: ctx,
      });

      return { pagamento, pontosCreditados };
    });

    return {
      pagamento: pagamentoDTO(saida.pagamento),
      pedido: { pedidoId: pedido.id, status: novoStatusPedido },
      pontosCreditados: saida.pontosCreditados,
      chamadasGateway: chamadas,
      reutilizado: false,
    };
  }

  async function obter(id, ctx) {
    const p = await db.pagamento.findUnique({ where: { id } });
    if (!p) throw Erros.naoEncontrado('pagamento');
    await pedidos.buscarVisivel(p.pedidoId, ctx.usuario, {});
    return pagamentoDTO(p);
  }

  async function listarPorPedido(pedidoId, ctx) {
    await pedidos.buscarVisivel(pedidoId, ctx.usuario, {});
    const lista = await db.pagamento.findMany({ where: { pedidoId }, orderBy: { id: 'asc' } });
    return lista.map(pagamentoDTO);
  }

  return { solicitar, obter, listarPorPedido };
}

module.exports = { criarPagamentoService };
