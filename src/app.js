const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yaml');

const { criarContainer } = require('./container');
const mw = require('./api/middlewares');
const authRoutes = require('./api/routes/auth.routes');
const usuariosRoutes = require('./api/routes/usuarios.routes');
const catalogoRoutes = require('./api/routes/catalogo.routes');
const operacaoRoutes = require('./api/routes/operacao.routes');

function criarApp(overrides = {}) {
  const container = criarContainer(overrides);
  const { env, db, token, services } = container;
  const auth = mw.criarAutenticacao({ token, db });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ exposedHeaders: ['X-Request-Id', 'Location', 'Idempotent-Replayed'] }));
  app.use(mw.requestId);
  app.use(mw.logAcesso);
  app.use(express.json({ limit: '100kb' }));

  // Documentacao OpenAPI (contrato real da API)
  const openapi = YAML.parse(fs.readFileSync(path.join(__dirname, 'api/docs/openapi.yaml'), 'utf8'));
  app.get('/openapi.json', (req, res) => res.json(openapi));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'Raizes do Nordeste API' }));
  app.get('/', (req, res) => res.redirect('/docs'));

  app.get('/health', async (req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      res.json({ status: 'UP', banco: 'UP', timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'DOWN', banco: 'DOWN', timestamp: new Date().toISOString() });
    }
  });

  const deps = { services, auth, env };
  const catalogo = catalogoRoutes(deps);
  const operacao = operacaoRoutes(deps);

  app.use('/auth', authRoutes(deps));
  app.use('/usuarios', usuariosRoutes(deps));
  app.use('/unidades', catalogo.unidades);
  app.use('/produtos', catalogo.produtos);
  app.use('/promocoes', catalogo.promocoes);
  app.use('/estoque', operacao.estoque);
  app.use('/pedidos', operacao.pedidos);
  app.use('/pagamentos', operacao.pagamentos);
  app.use('/fidelidade', operacao.fidelidade);
  app.use('/auditoria', operacao.auditoria);
  app.use('/relatorios', operacao.relatorios);

  app.use(mw.naoEncontrado);
  app.use(mw.errorHandler);

  app.locals.container = container;
  return app;
}

module.exports = { criarApp };
