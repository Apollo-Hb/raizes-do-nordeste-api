/**
 * Erros de dominio. Cada erro carrega o status HTTP e o codigo (campo "error")
 * do padrao unico de resposta de erro da API.
 */
class AppError extends Error {
  constructor(status, error, message, details = []) {
    super(message);
    this.status = status;
    this.error = error;
    this.details = details;
  }
}

const Erros = {
  validacao: (details, message = 'Um ou mais campos sao invalidos.') =>
    new AppError(422, 'VALIDACAO', message, details),
  requisicaoInvalida: (message) => new AppError(400, 'REQUISICAO_INVALIDA', message),
  naoAutenticado: (error = 'NAO_AUTENTICADO', message = 'Autenticacao necessaria.') =>
    new AppError(401, error, message),
  credenciaisInvalidas: () =>
    new AppError(401, 'CREDENCIAIS_INVALIDAS', 'E-mail ou senha invalidos.'),
  acessoNegado: (message = 'Seu perfil nao tem permissao para esta operacao.') =>
    new AppError(403, 'ACESSO_NEGADO', message),
  naoEncontrado: (recurso, details = []) =>
    new AppError(404, `${recurso.toUpperCase()}_NAO_ENCONTRADO`, `${capitalizar(recurso)} nao encontrado(a).`, details),
  conflito: (error, message, details = []) => new AppError(409, error, message, details),
  regraNegocio: (error, message, details = []) => new AppError(422, error, message, details),
  gatewayIndisponivel: (message) => new AppError(503, 'GATEWAY_PAGAMENTO_INDISPONIVEL', message),
};

function capitalizar(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replace(/_/g, ' ');
}

module.exports = { AppError, Erros };
