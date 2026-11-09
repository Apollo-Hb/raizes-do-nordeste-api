const { Router } = require('express');
const s = require('../schemas');
const { validar, rota, contexto } = require('../middlewares');
const { Erros } = require('../../domain/errors');

/** Le e valida o header Idempotency-Key (opcional). */
function idempotencyKey(req) {
  const k = req.get('Idempotency-Key');
  if (k === undefined) return undefined;
  if (!/^[\w-]{8,64}$/.test(k)) {
    throw Erros.validacao([{ field: 'Idempotency-Key', issue: 'Use de 8 a 64 caracteres alfanumericos, _ ou - (ex.: um UUID).' }]);
  }
  return k;
}

/** /estoque, /pedidos, /pagamentos, /fidelidade, /auditoria e /relatorios */
module.exports = ({ services, auth }) => {
  const { autenticar, autorizar } = auth;

  // ---------- Estoque ----------
  const estoque = Router();
  estoque.use(autenticar);
  estoque.get('/', autorizar('ATENDENTE', 'COZINHA', 'GERENTE', 'ADMIN'), validar(s.estoqueQuery, 'query'), rota(async (req, res) => {
    res.json(await services.estoque.consultarSaldo(req.filtros.unidadeId, contexto(req)));
  }));
  estoque.post('/movimentacoes', autorizar('GERENTE', 'ADMIN'), validar(s.movimentacao), rota(async (req, res) => {
    res.status(201).json(await services.estoque.movimentar(req.body, contexto(req)));
  }));
  estoque.get('/movimentacoes', autorizar('GERENTE', 'ADMIN'), validar(s.listarMovimentacoes, 'query'), rota(async (req, res) => {
    res.json(await services.estoque.listarMovimentacoes(req.filtros, contexto(req)));
  }));

  // ---------- Pedidos ----------
  const pedidos = Router();
  pedidos.use(autenticar);
  pedidos.post('/', autorizar('CLIENTE', 'ATENDENTE', 'GERENTE', 'ADMIN'), validar(s.criarPedido), rota(async (req, res) => {
    const { pedido, reutilizado } = await services.pedidos.criar(req.body, contexto(req), idempotencyKey(req));
    if (reutilizado) res.set('Idempotent-Replayed', 'true');
    res.status(reutilizado ? 200 : 201).location(`/pedidos/${pedido.pedidoId}`).json(pedido);
  }));
  pedidos.get('/', validar(s.listarPedidos, 'query'), rota(async (req, res) => {
    res.json(await services.pedidos.listar(req.filtros, contexto(req)));
  }));
  pedidos.get('/:id', validar(s.idParam, 'params'), rota(async (req, res) => {
    res.json(await services.pedidos.obter(req.params.id, contexto(req)));
  }));
  pedidos.patch(
    '/:id/status',
    autorizar('COZINHA', 'ATENDENTE', 'GERENTE', 'ADMIN'),
    validar(s.idParam, 'params'),
    validar(s.atualizarStatus),
    rota(async (req, res) => {
      res.json(await services.pedidos.atualizarStatus(req.params.id, req.body, contexto(req)));
    }),
  );
  pedidos.post(
    '/:id/cancelamento',
    autorizar('CLIENTE', 'ATENDENTE', 'GERENTE', 'ADMIN'),
    validar(s.idParam, 'params'),
    validar(s.cancelarPedido),
    rota(async (req, res) => {
      res.json(await services.pedidos.cancelar(req.params.id, req.body, contexto(req)));
    }),
  );
  pedidos.get('/:id/pagamentos', validar(s.idParam, 'params'), rota(async (req, res) => {
    res.json(await services.pagamentos.listarPorPedido(req.params.id, contexto(req)));
  }));

  // ---------- Pagamentos ----------
  const pagamentos = Router();
  pagamentos.use(autenticar);
  pagamentos.post('/', autorizar('CLIENTE', 'ATENDENTE', 'GERENTE', 'ADMIN'), validar(s.solicitarPagamento), rota(async (req, res) => {
    const out = await services.pagamentos.solicitar(req.body, contexto(req), idempotencyKey(req));
    if (out.reutilizado) res.set('Idempotent-Replayed', 'true');
    res.status(out.reutilizado ? 200 : 201).json(out);
  }));
  pagamentos.get('/:id', validar(s.idParam, 'params'), rota(async (req, res) => {
    res.json(await services.pagamentos.obter(req.params.id, contexto(req)));
  }));

  // ---------- Fidelidade ----------
  const fidelidade = Router();
  fidelidade.use(autenticar, autorizar('CLIENTE'));
  fidelidade.get('/saldo', rota(async (req, res) => res.json(await services.fidelidade.saldo(contexto(req)))));
  fidelidade.get('/extrato', validar(s.paginacao, 'query'), rota(async (req, res) => {
    res.json(await services.fidelidade.extrato(contexto(req), req.filtros));
  }));

  // ---------- Matriz: auditoria e relatorios ----------
  const auditoria = Router();
  auditoria.get('/', autenticar, autorizar('ADMIN'), validar(s.listarAuditoria, 'query'), rota(async (req, res) => {
    res.json(await services.gestao.listarAuditoria(req.filtros));
  }));
  const relatorios = Router();
  relatorios.get('/vendas', autenticar, autorizar('GERENTE', 'ADMIN'), validar(s.relatorioVendas, 'query'), rota(async (req, res) => {
    res.json(await services.gestao.relatorioVendas(req.filtros, contexto(req)));
  }));

  return { estoque, pedidos, pagamentos, fidelidade, auditoria, relatorios };
};
