/**
 * Utilitarios compartilhados pelos casos de uso: paginacao, mapeadores (DTOs) e escopo de acesso.
 * Os mapeadores garantem que respostas nunca exponham campos sensiveis (ex.: senhaHash).
 */
const { Perfil, PERFIS_FUNCIONARIO } = require('../domain/enums');
const { Erros } = require('../domain/errors');

const num = (d) => (d == null ? d : Number(d));

function paginar({ page = 1, limit = 10 }) {
  return { skip: (page - 1) * limit, take: limit };
}

function respostaPaginada(data, total, { page = 1, limit = 10 }) {
  return { data, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

/** Mascara e-mail para listagens (LGPD - minimizacao na exibicao): maria@cliente.com -> m***a@cliente.com */
function mascararEmail(email) {
  const [user, dominio] = String(email).split('@');
  if (!dominio) return '***';
  const ini = user.slice(0, 1);
  const fim = user.length > 2 ? user.slice(-1) : '';
  return `${ini}***${fim}@${dominio}`;
}

function usuarioDTO(u, { mascarar = false } = {}) {
  return {
    id: u.id,
    nome: u.nome,
    email: mascarar ? mascararEmail(u.email) : u.email,
    perfil: u.perfil,
    unidadeId: u.unidadeId,
    ativo: u.ativo,
    createdAt: u.createdAt,
  };
}

function produtoDTO(p) {
  return {
    id: p.id,
    nome: p.nome,
    descricao: p.descricao,
    categoria: p.categoria,
    preco: num(p.preco),
    exigeCozinhaCompleta: p.exigeCozinhaCompleta,
    sazonal: p.sazonal,
    disponivelDe: p.disponivelDe,
    disponivelAte: p.disponivelAte,
    ativo: p.ativo,
  };
}

function pagamentoDTO(p) {
  return {
    id: p.id,
    pedidoId: p.pedidoId,
    status: p.status,
    metodo: p.metodo,
    valor: num(p.valor),
    tentativa: p.tentativa,
    transacaoExternaId: p.transacaoExternaId,
    codigoRetorno: p.codigoRetorno,
    mensagem: p.mensagemRetorno,
    respostaGateway: p.payloadResposta ? JSON.parse(p.payloadResposta) : null,
    createdAt: p.createdAt,
  };
}

function pedidoDTO(p) {
  return {
    pedidoId: p.id,
    canalPedido: p.canalPedido,
    status: p.status,
    unidadeId: p.unidadeId,
    clienteId: p.clienteId,
    atendenteId: p.atendenteId,
    formaPagamento: p.formaPagamento,
    itens: (p.itens || []).map((i) => ({
      produtoId: i.produtoId,
      nome: i.produto?.nome,
      quantidade: i.quantidade,
      precoUnitario: num(i.precoUnitario),
      subtotal: num(i.subtotal),
    })),
    subtotal: num(p.subtotal),
    descontoPromocao: num(p.descontoPromocao),
    descontoPontos: num(p.descontoPontos),
    pontosResgatados: p.pontosResgatados,
    total: num(p.total),
    codigoPromocao: p.promocao?.codigo ?? null,
    observacao: p.observacao,
    motivoCancelamento: p.motivoCancelamento,
    ...(p.historico
      ? {
          historicoStatus: p.historico.map((h) => ({
            de: h.statusDe,
            para: h.statusPara,
            usuarioId: h.usuarioId,
            observacao: h.observacao,
            em: h.createdAt,
          })),
        }
      : {}),
    ...(p.pagamentos ? { pagamentos: p.pagamentos.map(pagamentoDTO) } : {}),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

const ehFuncionario = (u) => PERFIS_FUNCIONARIO.includes(u.perfil);

/** Funcionarios so operam a propria unidade; ADMIN (matriz) opera todas. */
function exigirAcessoUnidade(usuario, unidadeId) {
  if (usuario.perfil === Perfil.ADMIN) return;
  if (ehFuncionario(usuario) && usuario.unidadeId === unidadeId) return;
  throw Erros.acessoNegado('Voce so pode operar dados da sua propria unidade.');
}

/** Pedido visivel para: dono (cliente), equipe da unidade do pedido ou ADMIN. */
function podeVerPedido(usuario, pedido) {
  if (usuario.perfil === Perfil.ADMIN) return true;
  if (usuario.perfil === Perfil.CLIENTE) return pedido.clienteId === usuario.id;
  return usuario.unidadeId === pedido.unidadeId;
}

module.exports = {
  num,
  paginar,
  respostaPaginada,
  mascararEmail,
  usuarioDTO,
  produtoDTO,
  pedidoDTO,
  pagamentoDTO,
  ehFuncionario,
  exigirAcessoUnidade,
  podeVerPedido,
};
