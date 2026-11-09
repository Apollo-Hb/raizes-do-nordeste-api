const jwt = require('jsonwebtoken');
const env = require('../../config/env');

const ISSUER = 'raizes-do-nordeste-api';

// O token carrega apenas o minimo (id, perfil, unidade) - sem dados pessoais (minimizacao/LGPD).
function emitir(usuario) {
  return jwt.sign({ perfil: usuario.perfil, unidadeId: usuario.unidadeId ?? null }, env.jwtSecret, {
    subject: String(usuario.id),
    expiresIn: env.jwtExpiresIn,
    issuer: ISSUER,
    algorithm: 'HS256',
  });
}

function verificar(token) {
  return jwt.verify(token, env.jwtSecret, { issuer: ISSUER, algorithms: ['HS256'] });
}

module.exports = { emitir, verificar };
