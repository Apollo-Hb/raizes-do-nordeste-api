/**
 * Trilha de auditoria (append-only) de acoes sensiveis:
 * login, cancelamentos, mudancas de status, pagamentos, movimentacoes de estoque,
 * acesso/exportacao/anonimizacao de dados pessoais.
 * Os detalhes nunca devem conter senha, token ou dados de cartao.
 */
const CAMPOS_PROIBIDOS = ['senha', 'senhaHash', 'token', 'tokenPagamento', 'authorization'];

function sanitizar(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => !CAMPOS_PROIBIDOS.includes(k)),
  );
}

function criarAuditLogger(prisma) {
  async function registrar({ db = prisma, ator, acao, entidade, entidadeId, detalhes, contexto = {} }) {
    return db.auditLog.create({
      data: {
        usuarioId: ator?.id ?? null,
        perfil: ator?.perfil ?? null,
        acao,
        entidade,
        entidadeId: entidadeId != null ? String(entidadeId) : null,
        detalhes: detalhes ? JSON.stringify(sanitizar(detalhes)) : null,
        ip: contexto.ip ?? null,
        requestId: contexto.requestId ?? null,
      },
    });
  }
  return { registrar };
}

module.exports = { criarAuditLogger };
