const bcrypt = require('bcryptjs');
const env = require('../../config/env');

// Senhas nunca sao armazenadas em texto: bcrypt com salt aleatorio e custo configuravel.
const gerarHash = (senha) => bcrypt.hash(senha, env.bcryptRounds);
const comparar = (senha, hash) => bcrypt.compare(senha, hash);

module.exports = { gerarHash, comparar };
