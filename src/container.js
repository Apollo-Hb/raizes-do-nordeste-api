/**
 * Composition root: liga a camada de aplicacao as implementacoes de infraestrutura.
 * Trocar o gateway mock por um provedor real exige alterar apenas este arquivo.
 */
const env = require('./config/env');
const prisma = require('./infrastructure/database/prisma');
const senha = require('./infrastructure/security/senha');
const token = require('./infrastructure/security/token');
const { criarAuditLogger } = require('./infrastructure/audit/auditLogger');
const { criarMockPaymentGateway } = require('./infrastructure/payment/mockPaymentGateway');

const { criarAuthService } = require('./application/authService');
const { criarUsuarioService } = require('./application/usuarioService');
const { criarCatalogoService } = require('./application/catalogoService');
const { criarEstoqueService } = require('./application/estoqueService');
const { criarFidelidadeService } = require('./application/fidelidadeService');
const { criarPedidoService } = require('./application/pedidoService');
const { criarPagamentoService } = require('./application/pagamentoService');
const { criarGestaoService } = require('./application/gestaoService');

function criarContainer(overrides = {}) {
  const db = overrides.db || prisma;
  const audit = overrides.audit || criarAuditLogger(db);
  const gateway = overrides.gateway || criarMockPaymentGateway({ latenciaMs: env.paymentLatencyMs });

  const fidelidade = criarFidelidadeService({ db });
  const pedidos = criarPedidoService({ db, audit, fidelidade, gateway });

  const services = {
    auth: criarAuthService({ db, audit, senha, token, jwtExpiresIn: env.jwtExpiresIn }),
    usuarios: criarUsuarioService({ db, audit, senha }),
    catalogo: criarCatalogoService({ db, audit }),
    estoque: criarEstoqueService({ db, audit }),
    fidelidade,
    pedidos,
    pagamentos: criarPagamentoService({
      db,
      audit,
      gateway,
      fidelidade,
      pedidos,
      maxTentativas: env.paymentMaxTentativas,
      backoffBaseMs: overrides.backoffBaseMs ?? 100,
    }),
    gestao: criarGestaoService({ db }),
  };

  return { env, db, token, services };
}

module.exports = { criarContainer };
