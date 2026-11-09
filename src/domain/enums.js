// Enums do dominio (espelham os enums do schema.prisma).
const Perfil = Object.freeze({
  CLIENTE: 'CLIENTE',
  ATENDENTE: 'ATENDENTE',
  COZINHA: 'COZINHA',
  GERENTE: 'GERENTE',
  ADMIN: 'ADMIN',
});

const CanalPedido = Object.freeze({
  APP: 'APP',
  TOTEM: 'TOTEM',
  BALCAO: 'BALCAO',
  PICKUP: 'PICKUP',
  WEB: 'WEB',
});

const StatusPedido = Object.freeze({
  AGUARDANDO_PAGAMENTO: 'AGUARDANDO_PAGAMENTO',
  PAGAMENTO_RECUSADO: 'PAGAMENTO_RECUSADO',
  PAGO: 'PAGO',
  EM_PREPARO: 'EM_PREPARO',
  PRONTO: 'PRONTO',
  ENTREGUE: 'ENTREGUE',
  CANCELADO: 'CANCELADO',
});

const StatusPagamento = Object.freeze({
  APROVADO: 'APROVADO',
  RECUSADO: 'RECUSADO',
  ERRO: 'ERRO',
  ESTORNADO: 'ESTORNADO',
});

const MetodoPagamento = Object.freeze({
  PIX: 'PIX',
  CARTAO_CREDITO: 'CARTAO_CREDITO',
  CARTAO_DEBITO: 'CARTAO_DEBITO',
  MOCK: 'MOCK',
});

const TipoMovimentacao = Object.freeze({
  ENTRADA: 'ENTRADA',
  SAIDA: 'SAIDA',
  RESERVA_PEDIDO: 'RESERVA_PEDIDO',
  ESTORNO_PEDIDO: 'ESTORNO_PEDIDO',
});

const FinalidadeConsentimento = Object.freeze({
  FIDELIDADE: 'FIDELIDADE',
  MARKETING: 'MARKETING',
});

const PERFIS_FUNCIONARIO = [Perfil.ATENDENTE, Perfil.COZINHA, Perfil.GERENTE];

module.exports = {
  Perfil,
  CanalPedido,
  StatusPedido,
  StatusPagamento,
  MetodoPagamento,
  TipoMovimentacao,
  FinalidadeConsentimento,
  PERFIS_FUNCIONARIO,
};
