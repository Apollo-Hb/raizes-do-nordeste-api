const { Router } = require('express');
const s = require('../schemas');
const { validar, rota, contexto } = require('../middlewares');

/** /unidades, /produtos e /promocoes */
module.exports = ({ services, auth }) => {
  const admin = [auth.autenticar, auth.autorizar('ADMIN')];

  const unidades = Router();
  unidades.get('/', validar(s.listarUnidades, 'query'), rota(async (req, res) => {
    res.json(await services.catalogo.listarUnidades(req.filtros));
  }));
  unidades.get('/:id', validar(s.idParam, 'params'), rota(async (req, res) => {
    res.json(await services.catalogo.obterUnidade(req.params.id));
  }));
  unidades.get('/:id/cardapio', validar(s.idParam, 'params'), validar(s.cardapioQuery, 'query'), rota(async (req, res) => {
    res.json(
      await services.catalogo.cardapio(req.params.id, { apenasDisponiveis: req.filtros.disponiveis, categoria: req.filtros.categoria }),
    );
  }));
  unidades.post('/', ...admin, validar(s.criarUnidade), rota(async (req, res) => {
    res.status(201).json(await services.catalogo.criarUnidade(req.body, contexto(req)));
  }));

  const produtos = Router();
  produtos.get('/', validar(s.listarProdutos, 'query'), rota(async (req, res) => {
    res.json(await services.catalogo.listarProdutos(req.filtros));
  }));
  produtos.get('/:id', validar(s.idParam, 'params'), rota(async (req, res) => {
    res.json(await services.catalogo.obterProduto(req.params.id));
  }));
  produtos.post('/', ...admin, validar(s.criarProduto), rota(async (req, res) => {
    res.status(201).json(await services.catalogo.criarProduto(req.body, contexto(req)));
  }));
  produtos.put('/:id', ...admin, validar(s.idParam, 'params'), validar(s.atualizarProduto), rota(async (req, res) => {
    res.json(await services.catalogo.atualizarProduto(req.params.id, req.body, contexto(req)));
  }));
  produtos.delete('/:id', ...admin, validar(s.idParam, 'params'), rota(async (req, res) => {
    await services.catalogo.desativarProduto(req.params.id, contexto(req));
    res.status(204).end();
  }));

  const promocoes = Router();
  promocoes.get('/', rota(async (req, res) => res.json(await services.catalogo.listarPromocoes())));
  promocoes.post('/', ...admin, validar(s.criarPromocao), rota(async (req, res) => {
    res.status(201).json(await services.catalogo.criarPromocao(req.body, contexto(req)));
  }));

  return { unidades, produtos, promocoes };
};
