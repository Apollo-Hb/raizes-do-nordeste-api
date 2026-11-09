const { Router } = require('express');
const s = require('../schemas');
const { validar, rota, contexto } = require('../middlewares');

module.exports = ({ services, auth }) => {
  const r = Router();
  const { autenticar, autenticarOpcional, autorizar } = auth;

  // Cadastro publico de CLIENTE; com token ADMIN permite cadastrar funcionarios.
  r.post('/', autenticarOpcional, validar(s.cadastroUsuario), rota(async (req, res) => {
    res.status(201).json(await services.usuarios.cadastrar(req.body, contexto(req)));
  }));

  r.get('/me', autenticar, rota(async (req, res) => {
    res.json(await services.usuarios.perfilProprio(contexto(req)));
  }));

  r.put('/me/consentimentos', autenticar, autorizar('CLIENTE'), validar(s.consentimento), rota(async (req, res) => {
    res.json(await services.usuarios.registrarConsentimento(req.body, contexto(req)));
  }));

  r.get('/me/dados', autenticar, rota(async (req, res) => {
    res.json(await services.usuarios.exportarDados(contexto(req)));
  }));

  r.delete('/me', autenticar, autorizar('CLIENTE'), rota(async (req, res) => {
    await services.usuarios.anonimizar(contexto(req));
    res.status(204).end();
  }));

  r.get('/', autenticar, autorizar('ADMIN'), validar(s.listarUsuarios, 'query'), rota(async (req, res) => {
    res.json(await services.usuarios.listar(req.filtros));
  }));

  r.get('/:id', autenticar, autorizar('ADMIN'), validar(s.idParam, 'params'), rota(async (req, res) => {
    res.json(await services.usuarios.obterPorId(req.params.id, contexto(req)));
  }));
  return r;
};
