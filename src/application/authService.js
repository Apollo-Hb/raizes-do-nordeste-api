const { Erros } = require('../domain/errors');
const { mascararEmail } = require('./comum');

function criarAuthService({ db, audit, senha, token, jwtExpiresIn }) {
  async function login({ email, senha: senhaInformada }, ctx) {
    const usuario = await db.usuario.findUnique({ where: { email: email.toLowerCase() } });
    const valido = usuario && usuario.ativo && (await senha.comparar(senhaInformada, usuario.senhaHash));

    if (!valido) {
      // Mesma resposta para "e-mail inexistente" e "senha errada" (evita enumeracao de usuarios).
      await audit.registrar({
        ator: usuario ? { id: usuario.id, perfil: usuario.perfil } : null,
        acao: 'LOGIN_FALHA',
        entidade: 'Usuario',
        entidadeId: usuario?.id,
        detalhes: { email: mascararEmail(email) },
        contexto: ctx,
      });
      throw Erros.credenciaisInvalidas();
    }

    await audit.registrar({
      ator: usuario,
      acao: 'LOGIN_SUCESSO',
      entidade: 'Usuario',
      entidadeId: usuario.id,
      contexto: ctx,
    });

    return {
      accessToken: token.emitir(usuario),
      tokenType: 'Bearer',
      expiresIn: jwtExpiresIn,
      user: { id: usuario.id, nome: usuario.nome, perfil: usuario.perfil, unidadeId: usuario.unidadeId },
    };
  }

  return { login };
}

module.exports = { criarAuthService };
