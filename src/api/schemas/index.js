/**
 * Contratos de entrada (request) validados com Zod.
 * Qualquer violacao vira 422 VALIDACAO com a lista de campos em "details".
 */
const { z } = require('zod');
const { CanalPedido, StatusPedido, MetodoPagamento, Perfil, FinalidadeConsentimento } = require('../../domain/enums');

const id = z.coerce.number({ invalid_type_error: 'Deve ser numerico.' }).int().positive();
const enumDe = (obj, nome) =>
  z.enum(Object.values(obj), {
    errorMap: (issue, ctx) =>
      issue.code === 'invalid_enum_value' || issue.code === 'invalid_type'
        ? { message: ctx.data === undefined ? `${nome} e obrigatorio.` : `Valor invalido. Use: ${Object.values(obj).join(', ')}.` }
        : { message: ctx.defaultError },
  });

const paginacao = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
};

const senhaForte = z
  .string()
  .min(8, 'Minimo de 8 caracteres.')
  .max(72)
  .regex(/[A-Za-z]/, 'Deve conter letra.')
  .regex(/\d/, 'Deve conter numero.');

const schemas = {
  idParam: z.object({ id }),

  login: z.object({
    email: z.string({ required_error: 'email e obrigatorio.' }).trim().email('E-mail invalido.'),
    senha: z.string({ required_error: 'senha e obrigatoria.' }).min(1, 'senha e obrigatoria.'),
  }),

  cadastroUsuario: z.object({
    nome: z.string({ required_error: 'nome e obrigatorio.' }).trim().min(2).max(120),
    email: z.string({ required_error: 'email e obrigatorio.' }).trim().email('E-mail invalido.'),
    senha: senhaForte,
    perfil: enumDe(Perfil, 'perfil').optional(),
    unidadeId: id.optional(),
    consentimentoFidelidade: z.boolean().optional().default(false),
  }),

  listarUsuarios: z.object({ ...paginacao, perfil: enumDe(Perfil, 'perfil').optional() }),

  consentimento: z.object({
    finalidade: enumDe(FinalidadeConsentimento, 'finalidade'),
    concedido: z.boolean({ required_error: 'concedido e obrigatorio.' }),
  }),

  listarUnidades: z.object({ ...paginacao, uf: z.string().length(2).optional() }),
  criarUnidade: z.object({
    nome: z.string().trim().min(3).max(120),
    cidade: z.string().trim().min(2).max(80),
    uf: z.string().trim().length(2),
    tipoCozinha: z.enum(['COMPLETA', 'REDUZIDA']).default('COMPLETA'),
  }),
  cardapioQuery: z.object({
    disponiveis: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
    categoria: z.string().optional(),
  }),

  listarProdutos: z.object({ ...paginacao, categoria: z.string().optional(), busca: z.string().optional() }),
  criarProduto: z.object({
    nome: z.string().trim().min(2).max(120),
    descricao: z.string().max(500).optional(),
    categoria: z.string().trim().min(2).max(40).transform((s) => s.toUpperCase()),
    preco: z.number({ required_error: 'preco e obrigatorio.', invalid_type_error: 'preco deve ser numerico.' }).positive('Deve ser maior que zero.').multipleOf(0.01),
    exigeCozinhaCompleta: z.boolean().optional(),
    sazonal: z.boolean().optional(),
    disponivelDe: z.coerce.date().optional(),
    disponivelAte: z.coerce.date().optional(),
  }),

  estoqueQuery: z.object({ unidadeId: id }),
  movimentacao: z.object({
    unidadeId: id,
    produtoId: id,
    tipo: z.enum(['ENTRADA', 'SAIDA'], { errorMap: () => ({ message: 'Use ENTRADA ou SAIDA.' }) }),
    quantidade: z.number({ required_error: 'quantidade e obrigatoria.' }).int('Deve ser inteiro.').positive('Deve ser maior que zero.'),
    motivo: z.string().max(200).optional(),
  }),
  listarMovimentacoes: z.object({ ...paginacao, unidadeId: id, produtoId: id.optional() }),

  criarPedido: z.object({
    canalPedido: enumDe(CanalPedido, 'canalPedido'),
    unidadeId: z.number({ required_error: 'unidadeId e obrigatorio.', invalid_type_error: 'Deve ser numerico.' }).int().positive(),
    clienteId: z.number().int().positive().optional(),
    itens: z
      .array(
        z.object({
          produtoId: z.number({ required_error: 'produtoId e obrigatorio.', invalid_type_error: 'Deve ser numerico.' }).int().positive(),
          quantidade: z
            .number({ required_error: 'quantidade e obrigatoria.', invalid_type_error: 'Deve ser numerico.' })
            .int('Deve ser inteiro.')
            .positive('Deve ser maior que zero.')
            .max(50, 'Maximo de 50 unidades por item.'),
        }),
        { required_error: 'itens e obrigatorio.' },
      )
      .min(1, 'Informe ao menos 1 item.')
      .max(30),
    formaPagamento: enumDe(MetodoPagamento, 'formaPagamento'),
    codigoPromocao: z.string().trim().max(30).optional(),
    usarPontos: z.number().int().min(0).optional(),
    observacao: z.string().max(300).optional(),
  }),

  listarPedidos: z.object({
    ...paginacao,
    canalPedido: enumDe(CanalPedido, 'canalPedido').optional(),
    status: enumDe(StatusPedido, 'status').optional(),
    unidadeId: id.optional(),
    dataInicio: z.coerce.date().optional(),
    dataFim: z.coerce.date().optional(),
    ordem: z.enum(['asc', 'desc']).default('desc'),
  }),

  atualizarStatus: z.object({
    status: enumDe(StatusPedido, 'status'),
    observacao: z.string().max(300).optional(),
  }),

  cancelarPedido: z.object({ motivo: z.string({ required_error: 'motivo e obrigatorio.' }).trim().min(3).max(300) }),

  solicitarPagamento: z.object({
    pedidoId: z.number({ required_error: 'pedidoId e obrigatorio.', invalid_type_error: 'Deve ser numerico.' }).int().positive(),
    metodo: enumDe(MetodoPagamento, 'metodo').optional(),
    tokenPagamento: z.string().max(60).optional(),
  }),

  criarPromocao: z.object({
    codigo: z.string().trim().min(3).max(30).transform((s) => s.toUpperCase()),
    descricao: z.string().trim().min(3).max(200),
    percentualDesconto: z.number().int().min(1).max(90),
    unidadeId: z.number().int().positive().optional(),
    canalPedido: enumDe(CanalPedido, 'canalPedido').optional(),
    inicio: z.coerce.date(),
    fim: z.coerce.date(),
  }),

  listarAuditoria: z.object({
    ...paginacao,
    acao: z.string().optional(),
    entidade: z.string().optional(),
    entidadeId: z.string().optional(),
    usuarioId: id.optional(),
  }),

  relatorioVendas: z.object({
    unidadeId: id.optional(),
    dataInicio: z.coerce.date().optional(),
    dataFim: z.coerce.date().optional(),
  }),

  paginacao: z.object(paginacao),
};

schemas.atualizarProduto = schemas.criarProduto.partial().refine((o) => Object.keys(o).length > 0, {
  message: 'Informe ao menos um campo para atualizar.',
});

module.exports = schemas;
