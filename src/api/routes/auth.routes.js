const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const s = require('../schemas');
const { validar, rota, contexto } = require('../middlewares');
const { AppError } = require('../../domain/errors');

module.exports = ({ services, env }) => {
  const r = Router();
  // Protecao contra forca bruta: conta apenas tentativas FALHAS por IP na janela de 15 min.
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: env.loginRateLimit,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res, next) =>
      next(new AppError(429, 'MUITAS_TENTATIVAS', 'Muitas tentativas de login. Aguarde 15 minutos.')),
  });

  r.post('/login', limiter, validar(s.login), rota(async (req, res) => {
    res.json(await services.auth.login(req.body, contexto(req)));
  }));
  return r;
};
