// Calculos monetarios em centavos (inteiros) para evitar erro de ponto flutuante.
const paraCentavos = (valor) => Math.round(Number(valor) * 100);
const paraReais = (centavos) => Number((centavos / 100).toFixed(2));

module.exports = { paraCentavos, paraReais };
