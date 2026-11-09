/**
 * Portas (interfaces) que a camada de aplicacao espera da infraestrutura.
 *
 * PaymentGateway:
 *   solicitarPagamento({ referencia, valor, metodo, tokenPagamento, idempotencyKey })
 *     -> Promise<{ status: 'APROVADO'|'RECUSADO', transacaoId, codigo, mensagem, payload }>
 *     -> rejeita com GatewayIndisponivelError em timeout/falha de comunicacao
 *   estornar({ transacaoId, valor }) -> Promise<{ status: 'ESTORNADO', ... }>
 *
 * AuditLogger:
 *   registrar({ db?, ator, acao, entidade, entidadeId, detalhes, contexto }) -> Promise<void>
 */
class GatewayIndisponivelError extends Error {
  constructor(message = 'Gateway de pagamento nao respondeu (timeout).') {
    super(message);
    this.name = 'GatewayIndisponivelError';
  }
}

module.exports = { GatewayIndisponivelError };
