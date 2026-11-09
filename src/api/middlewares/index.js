/**
 * Middlewares da camada API: requestId, autenticacao JWT, autorizacao por perfil,
 * validacao de contrato e tratamento centralizado de erros (padrao unico de erro).
 */
const crypto = require('node:crypto');
const { AppError, Erros } = require('../../domain/errors');

/** Correlaciona logs, auditoria e resposta de erro pelo mesmo identificador. */
function requestId(req, res, next) {
  const recebido = req.get('X-Request-Id');
  req.id = recebido && /^[\w-]{8,64}$/.test(recebido) ? recebido : crypto.randomUUID();
  res.set('X-Request-Id', req.id);
  next();
}

/** Log estruturado de acesso (sem corpo da requisicao para nao vazar dados pessoais). */
function logAcesso(req, res, next) {
  const inicio = process.hrtime.bigint();
  res.on('finish', () => {
    if (process.env.NODE_ENV === 'test') return;
    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        requestId: req.id,
        metodo: req.method,
        rota: req.originalUrl.split('?')[0],
        status: res.statusCode,
        ms: Number(ms.toFixed(1)),
        usuarioId: req.usuario?.id ?? null,
      }),
    );
  });
  next();
}

function contexto(req) {
  return { usuario: req.usuario, ip: req.ip, requestId: req.id };
}

function criarAutenticacao({ token, db }) {
  /** Exige token Bearer valido e usuario ativo. */
  async function autenticar(req, res, next) {
    try {
      const header = req.get('Authorization') || '';
      const [tipo, valor] = header.split(' ');
      if (tipo !== 'Bearer' || !valor) {
        throw Erros.naoAutenticado('TOKEN_AUSENTE', 'Envie o header Authorization: Bearer <token>.');
      }
      let payload;
      try {
        payload = token.verificar(valor);
      } catch (e) {
        throw Erros.naoAutenticado(
          e.name === 'TokenExpiredError' ? 'TOKEN_EXPIRADO' : 'TOKEN_INVALIDO',
          e.name === 'TokenExpiredError' ? 'Token expirado. Faca login novamente.' : 'Token invalido.',
        );
      }
      const usuario = await db.usuario.findUnique({
        where: { id: Number(payload.sub) },
        select: { id: true, nome: true, perfil: true, unidadeId: true, ativo: true },
      });
      if (!usuario || !usuario.ativo) throw Erros.naoAutenticado('TOKEN_INVALIDO', 'Usuario inativo ou removido.');
      req.usuario = usuario;
      next();
    } catch (e) {
      next(e);
    }
  }

  /** Autenticacao opcional (ex.: POST /usuarios e publico, mas ADMIN pode criar funcionarios). */
  async function autenticarOpcional(req, res, next) {
    if (!req.get('Authorization')) return next();
    return autenticar(req, res, next);
  }

  /** RBAC: libera apenas os perfis informados. */
  const autorizar =
    (...perfis) =>
    (req, res, next) => {
      if (!req.usuario) return next(Erros.naoAutenticado());
      if (!perfis.includes(req.usuario.perfil)) {
        return next(Erros.acessoNegado(`Requer perfil: ${perfis.join(', ')}.`));
      }
      next();
    };

  return { autenticar, autenticarOpcional, autorizar };
}

/** Valida body/query/params com Zod e substitui pelos dados normalizados. */
const validar = (schema, origem = 'body') => (req, res, next) => {
  const r = schema.safeParse(req[origem] ?? {});
  if (!r.success) {
    const details = r.error.issues.map((i) => ({
      field: i.path.length ? i.path.map((p, idx) => (typeof p === 'number' ? `[${p}]` : `${idx ? '.' : ''}${p}`)).join('') : origem,
      issue: i.message,
    }));
    return next(Erros.validacao(details));
  }
  if (origem === 'query') req.filtros = r.data;
  else req[origem] = r.data;
  next();
};

/** Wrapper para handlers async (encaminha excecoes ao errorHandler). */
const rota = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function naoEncontrado(req, res, next) {
  next(new AppError(404, 'ROTA_NAO_ENCONTRADA', `Rota ${req.method} ${req.path} nao existe.`));
}

/** Padrao UNICO de erro para todas as falhas da API. */
function errorHandler(err, req, res, _next) {
  let e = err;
  if (err.type === 'entity.parse.failed') {
    e = Erros.requisicaoInvalida('JSON malformado no corpo da requisicao.');
  } else if (err.type === 'entity.too.large') {
    e = new AppError(413, 'PAYLOAD_MUITO_GRANDE', 'Corpo da requisicao excede o limite.');
  } else if (err.code === 'P2002') {
    e = Erros.conflito('REGISTRO_DUPLICADO', 'Violacao de unicidade.', [{ field: String(err.meta?.target ?? ''), issue: 'Ja existe.' }]);
  } else if (!(err instanceof AppError)) {
    console.error(JSON.stringify({ requestId: req.id, erro: err.message, stack: err.stack }));
    // Nunca expor stack/mensagem interna ao cliente.
    e = new AppError(500, 'ERRO_INTERNO', 'Erro inesperado. Informe o requestId ao suporte.');
  }
  res.status(e.status).json({
    error: e.error,
    message: e.message,
    details: e.details || [],
    timestamp: new Date().toISOString(),
    path: req.originalUrl.split('?')[0],
    requestId: req.id,
  });
}

module.exports = { requestId, logAcesso, contexto, criarAutenticacao, validar, rota, naoEncontrado, errorHandler };
