/**
 * Gateway de pagamento SIMULADO (mock).
 * A Raizes do Nordeste nao processa pagamentos: apenas solicita, recebe o retorno,
 * registra e atualiza o pedido. Este adaptador imita um provedor externo (PSP).
 *
 * Contrato (porta usada pela camada de aplicacao):
 *   solicitarPagamento({ referencia, valor, metodo, tokenPagamento, idempotencyKey })
 *     -> { status: 'APROVADO' | 'RECUSADO', transacaoId, codigo, mensagem, payload }
 *     -> lanca GatewayIndisponivelError em timeout/falha de comunicacao
 *
 * Tokens de teste (inspirados nos "test tokens" de provedores reais):
 *   tok_aprovado      -> aprovado (padrao quando nenhum token e enviado)
 *   tok_recusado      -> recusado por saldo/limite insuficiente
 *   tok_cartao_bloq   -> recusado por cartao bloqueado
 *   tok_instavel      -> falha na 1a tentativa e aprova na 2a (demonstra retry)
 *   tok_indisponivel  -> gateway fora do ar em todas as tentativas
 */
const crypto = require('node:crypto');

const { GatewayIndisponivelError } = require('../../application/portas');

function criarMockPaymentGateway({ latenciaMs = 0 } = {}) {
  const tentativasPorChave = new Map();
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  async function solicitarPagamento({ referencia, valor, metodo, tokenPagamento = 'tok_aprovado', idempotencyKey }) {
    if (latenciaMs) await esperar(latenciaMs);

    const chave = idempotencyKey || `${referencia}`;
    const tentativa = (tentativasPorChave.get(chave) || 0) + 1;
    tentativasPorChave.set(chave, tentativa);

    if (tokenPagamento === 'tok_indisponivel') throw new GatewayIndisponivelError();
    if (tokenPagamento === 'tok_instavel' && tentativa === 1) throw new GatewayIndisponivelError();

    const transacaoId = `mock_txn_${crypto.randomUUID()}`;
    const base = { transacaoId, referencia, valor, metodo, processadoEm: new Date().toISOString() };

    if (tokenPagamento === 'tok_recusado') {
      return {
        status: 'RECUSADO',
        transacaoId,
        codigo: 'SALDO_INSUFICIENTE',
        mensagem: 'Pagamento recusado pelo emissor: saldo ou limite insuficiente.',
        payload: { ...base, status: 'declined', decline_code: 'insufficient_funds' },
      };
    }
    if (tokenPagamento === 'tok_cartao_bloq') {
      return {
        status: 'RECUSADO',
        transacaoId,
        codigo: 'CARTAO_BLOQUEADO',
        mensagem: 'Pagamento recusado: cartao bloqueado. Utilize outro meio de pagamento.',
        payload: { ...base, status: 'declined', decline_code: 'card_blocked' },
      };
    }
    return {
      status: 'APROVADO',
      transacaoId,
      codigo: 'APROVADO',
      mensagem: 'Pagamento aprovado.',
      payload: {
        ...base,
        status: 'approved',
        authorization_code: crypto.randomInt(100000, 999999).toString(),
        ...(metodo === 'PIX' ? { pix_e2e_id: `E${Date.now()}MOCK` } : {}),
      },
    };
  }

  async function estornar({ transacaoId, valor }) {
    if (latenciaMs) await esperar(latenciaMs);
    return { status: 'ESTORNADO', transacaoId, valor, estornadoEm: new Date().toISOString() };
  }

  return { nome: 'MOCK_PSP', solicitarPagamento, estornar };
}

module.exports = { criarMockPaymentGateway, GatewayIndisponivelError };
