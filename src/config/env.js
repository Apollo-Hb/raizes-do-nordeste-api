require('dotenv').config({ quiet: true });

function num(name, fallback) {
  const v = process.env[name];
  const n = v === undefined || v === '' ? fallback : Number(v);
  if (Number.isNaN(n)) throw new Error(`Variavel de ambiente ${name} invalida`);
  return n;
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: num('PORT', 3000),
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: num('JWT_EXPIRES_IN', 3600),
  bcryptRounds: num('BCRYPT_ROUNDS', 10),
  paymentLatencyMs: num('PAYMENT_MOCK_LATENCY_MS', 150),
  paymentMaxTentativas: num('PAYMENT_MAX_TENTATIVAS', 3),
  loginRateLimit: num('LOGIN_RATE_LIMIT', 20),
};

if (env.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET ausente ou curto demais (minimo 32 caracteres). Veja .env.example');
}

module.exports = env;
