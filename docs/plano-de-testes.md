# Plano de Testes — Raízes do Nordeste API

**Estratégia:** cada cenário existe em dois lugares: no teste automatizado (`tests/api.test.js`, rodado com `npm test`) e
na coleção Postman (`postman/`, rodada com o Runner ou com `npm run test:postman`). A requisição na coleção tem o mesmo ID.

**Pré-condição geral:** `npm run setup` (ou `npm run db:seed`) e API no ar (`npm start`). A pasta `00 Setup` faz login com
cada perfil e guarda os tokens. Senha de todos os usuários: `Senha@123`.

**Resumo:** 30 cenários: **13 positivos**, **15 negativos** e 2 que cobrem os dois casos (T24 e T25). Execução de 09/11/2026: 40/40 testes automatizados aprovados
e 95/95 asserts da coleção Postman aprovados (54 requisições).

| ID | Cenário | Endpoint | Pré-condição | Entrada | Esperado (status + response) | Evidência (coleção) | Tipo |
|---|---|---|---|---|---|---|---|
| T01 | Login válido | `POST /auth/login` | seed aplicado | `{email: maria@cliente.com, senha: Senha@123}` | 200; `accessToken` JWT, `tokenType: Bearer`, sem `senhaHash` | 01 Auth / T01 Login valido (CLIENTE) | + |
| T02 | Senha inválida | `POST /auth/login` | seed | senha errada | 401; `error: CREDENCIAIS_INVALIDAS` | 01 Auth / T02 | − |
| T03 | Acesso sem token | `GET /pedidos` | — | sem header Authorization | 401; `error: TOKEN_AUSENTE` | 01 Auth / T03 | − |
| T04 | Perfil sem permissão | `POST /produtos` | token CLIENTE | produto válido | 403; `error: ACESSO_NEGADO` | 01 Auth / T04 | − |
| T05 | Cardápio por unidade | `GET /unidades/2/cardapio` | seed | — | 200; tapioca com preço local 27.90; `disponivel` em cada item | 02 Catalogo / T05 | + |
| T06 | Pedido válido (APP) | `POST /pedidos` | token CLIENTE | `canalPedido: APP`, unidade 1, 2× produto 1 + 1× produto 3, PIX | 201; `status: AGUARDANDO_PAGAMENTO`, `canalPedido: APP`, `total: 59.7`, header Location | 03 Pedidos / T06 | + |
| T07 | Sem `canalPedido` | `POST /pedidos` | token CLIENTE | corpo sem canalPedido | 422; `VALIDACAO`, `details[].field = canalPedido` | 03 Pedidos / T07 | − |
| T08 | Canal inválido e quantidade negativa | `POST /pedidos` | token CLIENTE | `canalPedido: FAX`, `quantidade: -2` | 422; campos `canalPedido` e `itens[0].quantidade` | 03 Pedidos / T08 | − |
| T09 | Produto inexistente | `POST /pedidos` | token CLIENTE | `produtoId: 9999` | 404; `PRODUTO_NAO_ENCONTRADO` | 03 Pedidos / T09 | − |
| T10 | Unidade inexistente | `POST /pedidos` | token CLIENTE | `unidadeId: 999` | 404; `UNIDADE_NAO_ENCONTRADO` | 03 Pedidos / T10 | − |
| T11 | Estoque insuficiente | `POST /pedidos` | suco com 3 un. na unidade 1 | quantidade acima do saldo | 409; `ESTOQUE_INSUFICIENTE`, `issue: Disponivel: 3` | 03 Pedidos / T11 | − |
| T12 | Pagamento mock aprovado | `POST /pagamentos` | pedido T06 | `tokenPagamento: tok_aprovado` | 201; `pagamento.status: APROVADO`, `pedido.status: PAGO`, `transacaoExternaId mock_txn_*`, `pontosCreditados: 59` | 04 Pagamento / T12 | + |
| T13 | Pagamento mock recusado | `POST /pagamentos` | pedido TOTEM novo | `tok_recusado` | 201; `pagamento.status: RECUSADO`, `codigoRetorno: SALDO_INSUFICIENTE`, mensagem "recusado", `pedido.status: PAGAMENTO_RECUSADO` | 04 Pagamento / T13a, T13b | − |
| T14 | Pagar pedido já pago | `POST /pagamentos` | pedido T06 pago | mesmo pedidoId | 409; `PEDIDO_JA_PAGO` | 04 Pagamento / T14 | − |
| T15 | Gateway indisponível | `POST /pagamentos` | pedido WEB novo | `tok_indisponivel` | 503; `GATEWAY_PAGAMENTO_INDISPONIVEL`; pedido segue `AGUARDANDO_PAGAMENTO` com tentativa `ERRO` | 04 Pagamento / T15a-c | − |
| T16 | Fluxo de status | `PATCH /pedidos/{id}/status` | pedido PAGO; tokens COZINHA e ATENDENTE | EM_PREPARO → PRONTO → ENTREGUE | 200 em cada passo; `historicoStatus` completo | 05 Status / T16a-c | + |
| T17 | Transição inválida | `PATCH /pedidos/{id}/status` | pedido PAGAMENTO_RECUSADO | `status: PRONTO` | 409; `TRANSICAO_STATUS_INVALIDA` | 05 Status / T17 | − |
| T18 | Isolamento entre unidades | `GET /pedidos/{id}` | token GERENTE unidade 2 | pedido da unidade 1 | 404; `PEDIDO_NAO_ENCONTRADO` | 05 Status / T18 | − |
| T19 | Pedido no balcão | `POST /pedidos` | token ATENDENTE | `canalPedido: BALCAO`, `clienteId: 7` | 201; `canalPedido: BALCAO`, `atendenteId` preenchido | 06 Multicanal / T19 | + |
| T20 | Filtro por canal | `GET /pedidos?canalPedido=TOTEM` | pedidos TOTEM existentes | query param | 200; todos com `canalPedido: TOTEM`; `meta` de paginação | 06 Multicanal / T20 | + |
| T21 | Idempotência | `POST /pedidos` 2× | token CLIENTE | mesmo header `Idempotency-Key` | 1ª 201, 2ª 200 com o mesmo `pedidoId` e `Idempotent-Replayed: true` | 07 / T21a, T21b | + |
| T22 | Cancelamento | `POST /pedidos/{id}/cancelamento` | pedido aguardando pagamento | `{motivo}` | 200; `status: CANCELADO`; estoque devolvido | 07 / T22 | + |
| T23 | Auditoria de ação sensível | `GET /auditoria?entidade=Pedido&entidadeId={id}` | T21/T22 executados; token ADMIN | — | 200; registros `PEDIDO_CRIADO` e `PEDIDO_CANCELADO` com usuário e requestId | 07 / T23 | + |
| T24 | Estoque por unidade | `POST /estoque/movimentacoes` | token GERENTE unidade 1 | ENTRADA de 20 un. na unidade 1; depois na unidade 2 | 201 com `saldoAtual`; na unidade 2, 403 | 08 Estoque / T24a, T24b | + / − |
| T25 | Cadastro e validação de e-mail | `POST /usuarios` | — | e-mail inválido; depois cadastro válido | 422 (campo `email`); 201 sem `senhaHash`, hash bcrypt no banco, consentimento negado registrado | 09 LGPD / T25a, T25b | − / + |
| T26 | Resgate sem consentimento | `POST /pedidos` | cliente sem consentimento | `usarPontos: 10` | 422; `CONSENTIMENTO_NECESSARIO` | 09 LGPD / T26 | − |
| T27 | Saldo de fidelidade | `GET /fidelidade/saldo` | Maria com consentimento | — | 200; `consentimentoAtivo: true`, saldo 259 (200 do seed + 59 de T12) | 09 LGPD / T27 | + |
| T28 | Exportação e anonimização | `GET /usuarios/me/dados`, `DELETE /usuarios/me` | cliente novo | — | 200 com dados do titular; 204; token seguinte → 401 `TOKEN_INVALIDO`; novo login → 401 | 09 LGPD / T28a-c | + |
| T29 | Relatório da matriz | `GET /relatorios/vendas` | pedidos pagos; token ADMIN | — | 200; consolidado `porCanal`, `porUnidade`, `produtosMaisVendidos` | 10 Matriz / T29 | + |
| T30 | JSON malformado | `POST /pedidos` | token CLIENTE | corpo `{"canalPedido": ` | 400; `REQUISICAO_INVALIDA` | 10 Matriz e Erros / T30 | − |

**Testes de domínio (unitários, `tests/dominio.test.js`):** cálculo de totais com promoção e limite de 50% para pontos;
precisão monetária em centavos; transições válidas e inválidas da máquina de estados; perfis por transição; produto que
exige cozinha completa; produto sazonal fora da janela; canal BALCÃO proibido para cliente; promoção exclusiva de canal;
cálculo de pontos.

**Testes não funcionais (propostos para produção):** carga com k6 ou JMeter simulando o pico do café da manhã
(meta: p95 < 300 ms em `POST /pedidos` com 200 requisições/s); concorrência na reserva de estoque (N pedidos simultâneos
do último item: só um pode ser aceito, garantido pelo `UPDATE ... WHERE quantidade >= x`); varredura OWASP ZAP no Swagger.
