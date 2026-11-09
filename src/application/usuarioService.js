/**
 * Casos de uso de usuarios e direitos do titular (LGPD art. 18):
 * cadastro, consulta, consentimento, exportacao (portabilidade) e anonimizacao.
 */
const crypto = require('node:crypto');
const { Perfil, PERFIS_FUNCIONARIO, FinalidadeConsentimento } = require('../domain/enums');
const { Erros } = require('../domain/errors');
const { REGRAS_FIDELIDADE } = require('../domain/fidelidade');
const { usuarioDTO, paginar, respostaPaginada, num } = require('./comum');

function criarUsuarioService({ db, audit, senha }) {
  async function consentimentosAtuais(usuarioId, client = db) {
    const registros = await client.consentimento.findMany({ where: { usuarioId }, orderBy: { id: 'desc' } });
    const atual = {};
    for (const f of Object.values(FinalidadeConsentimento)) {
      const r = registros.find((x) => x.finalidade === f);
      atual[f] = r ? { concedido: r.concedido, versaoTermo: r.versaoTermo, em: r.createdAt } : { concedido: false };
    }
    return atual;
  }

  async function cadastrar(input, ctx) {
    const perfil = input.perfil || Perfil.CLIENTE;
    const ator = ctx.usuario;

    if (perfil !== Perfil.CLIENTE && ator?.perfil !== Perfil.ADMIN) {
      throw Erros.acessoNegado('Somente ADMIN pode cadastrar funcionarios ou administradores.');
    }
    if (PERFIS_FUNCIONARIO.includes(perfil)) {
      if (!input.unidadeId) {
        throw Erros.validacao([{ field: 'unidadeId', issue: 'Obrigatorio para perfis de funcionario.' }]);
      }
      const unidade = await db.unidade.findUnique({ where: { id: input.unidadeId } });
      if (!unidade) throw Erros.naoEncontrado('unidade');
    }

    const email = input.email.toLowerCase();
    if (await db.usuario.findUnique({ where: { email } })) {
      throw Erros.conflito('EMAIL_JA_CADASTRADO', 'Ja existe um usuario com este e-mail.', [
        { field: 'email', issue: 'Em uso.' },
      ]);
    }

    const usuario = await db.$transaction(async (tx) => {
      const novo = await tx.usuario.create({
        data: {
          nome: input.nome,
          email,
          senhaHash: await senha.gerarHash(input.senha),
          perfil,
          unidadeId: PERFIS_FUNCIONARIO.includes(perfil) ? input.unidadeId : null,
        },
      });
      if (perfil === Perfil.CLIENTE) {
        // O consentimento e explicito e registrado com a versao do termo, mesmo quando negado.
        await tx.consentimento.create({
          data: {
            usuarioId: novo.id,
            finalidade: FinalidadeConsentimento.FIDELIDADE,
            concedido: Boolean(input.consentimentoFidelidade),
            versaoTermo: REGRAS_FIDELIDADE.versaoTermo,
          },
        });
      }
      await audit.registrar({
        db: tx,
        ator: ator || { id: novo.id, perfil: novo.perfil },
        acao: 'USUARIO_CRIADO',
        entidade: 'Usuario',
        entidadeId: novo.id,
        detalhes: { perfil, unidadeId: novo.unidadeId },
        contexto: ctx,
      });
      return novo;
    });

    return { ...usuarioDTO(usuario), consentimentos: await consentimentosAtuais(usuario.id) };
  }

  async function perfilProprio(ctx) {
    const u = await db.usuario.findUnique({ where: { id: ctx.usuario.id } });
    return { ...usuarioDTO(u), consentimentos: await consentimentosAtuais(u.id) };
  }

  async function listar(filtros) {
    const where = { ...(filtros.perfil ? { perfil: filtros.perfil } : {}), anonimizadoEm: null };
    const [total, itens] = await Promise.all([
      db.usuario.count({ where }),
      db.usuario.findMany({ where, ...paginar(filtros), orderBy: { id: 'asc' } }),
    ]);
    // Listagem administrativa exibe e-mail mascarado (minimizacao).
    return respostaPaginada(itens.map((u) => usuarioDTO(u, { mascarar: true })), total, filtros);
  }

  async function obterPorId(id, ctx) {
    const u = await db.usuario.findUnique({ where: { id } });
    if (!u) throw Erros.naoEncontrado('usuario');
    // Acesso de terceiro a dados pessoais completos e auditado.
    await audit.registrar({
      ator: ctx.usuario,
      acao: 'ACESSO_DADOS_PESSOAIS',
      entidade: 'Usuario',
      entidadeId: id,
      contexto: ctx,
    });
    return { ...usuarioDTO(u), consentimentos: await consentimentosAtuais(u.id) };
  }

  async function registrarConsentimento({ finalidade, concedido }, ctx) {
    await db.consentimento.create({
      data: { usuarioId: ctx.usuario.id, finalidade, concedido, versaoTermo: REGRAS_FIDELIDADE.versaoTermo },
    });
    await audit.registrar({
      ator: ctx.usuario,
      acao: concedido ? 'CONSENTIMENTO_CONCEDIDO' : 'CONSENTIMENTO_REVOGADO',
      entidade: 'Consentimento',
      entidadeId: ctx.usuario.id,
      detalhes: { finalidade, versaoTermo: REGRAS_FIDELIDADE.versaoTermo },
      contexto: ctx,
    });
    return consentimentosAtuais(ctx.usuario.id);
  }

  /** Portabilidade/acesso (LGPD art. 18, II e V): devolve todos os dados pessoais do titular. */
  async function exportarDados(ctx) {
    const id = ctx.usuario.id;
    const u = await db.usuario.findUnique({
      where: { id },
      include: {
        consentimentos: { orderBy: { id: 'asc' } },
        transacoesFidelidade: { orderBy: { id: 'asc' } },
        pedidos: { include: { itens: true }, orderBy: { id: 'asc' } },
      },
    });
    await audit.registrar({ ator: ctx.usuario, acao: 'EXPORTACAO_DADOS', entidade: 'Usuario', entidadeId: id, contexto: ctx });
    return {
      geradoEm: new Date().toISOString(),
      titular: usuarioDTO(u),
      consentimentos: u.consentimentos.map((c) => ({
        finalidade: c.finalidade,
        concedido: c.concedido,
        versaoTermo: c.versaoTermo,
        em: c.createdAt,
      })),
      fidelidade: u.transacoesFidelidade.map((t) => ({ tipo: t.tipo, pontos: t.pontos, descricao: t.descricao, em: t.createdAt })),
      pedidos: u.pedidos.map((p) => ({
        pedidoId: p.id,
        canalPedido: p.canalPedido,
        status: p.status,
        total: num(p.total),
        createdAt: p.createdAt,
        itens: p.itens.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade })),
      })),
    };
  }

  /**
   * Eliminacao (LGPD art. 18, VI) por ANONIMIZACAO: os pedidos permanecem para obrigacoes
   * fiscais/contabeis (art. 16, I), mas deixam de ser associaveis a uma pessoa identificada.
   */
  async function anonimizar(ctx) {
    const id = ctx.usuario.id;
    await db.$transaction(async (tx) => {
      await tx.usuario.update({
        where: { id },
        data: {
          nome: 'Titular anonimizado',
          email: `anonimizado-${id}-${crypto.randomUUID()}@anonimizado.local`,
          senhaHash: await senha.gerarHash(crypto.randomUUID()),
          ativo: false,
          anonimizadoEm: new Date(),
        },
      });
      for (const finalidade of Object.values(FinalidadeConsentimento)) {
        await tx.consentimento.create({
          data: { usuarioId: id, finalidade, concedido: false, versaoTermo: REGRAS_FIDELIDADE.versaoTermo },
        });
      }
      await audit.registrar({ db: tx, ator: ctx.usuario, acao: 'ANONIMIZACAO_TITULAR', entidade: 'Usuario', entidadeId: id, contexto: ctx });
    });
  }

  return { cadastrar, perfilProprio, listar, obterPorId, registrarConsentimento, exportarDados, anonimizar, consentimentosAtuais };
}

module.exports = { criarUsuarioService };
