## 1. Remover COLORIDO do checkout

- [x] 1.1 Em `src/components/impressao/ConfiguracaoImpressao.tsx`, remover o `RadioGroupItem` COLORIDO. Como sobra só `PB`, simplificar a UI para exibir "Preto e branco" (sem escolha de modo) e fixar `modo = "PB"`.
- [x] 1.2 Em `src/lib/pricing.ts`, relaxar a validação para exigir apenas `precos.PB` (remover a checagem de `precos.COLORIDO === undefined` e a mensagem correspondente).
- [x] 1.3 Confirmar que `src/lib/types.ts` mantém `ModoCor = "PB" | "COLORIDO"` (compatibilidade com pedidos legados) e que nada mais depende da escolha de COLORIDO na UI.
- [x] 1.4 Confirmar que `create-pix` e o INSERT continuam genéricos (`modo_cor` sempre `PB`); nenhum hardcode de COLORIDO a remover no backend.

## 2. PIX com validade de 30 minutos

- [x] 2.1 Em `api/payments/create-pix.ts`, montar `date_of_expiration = agora + 30 min` em ISO **com offset de fuso** (ex.: `...-03:00`) e incluí-lo no corpo do `mpPayment.create`.
- [x] 2.2 Em `src/hooks/usePedidoStatus.ts`, remover o corte fixo `TIMEOUT_MS = 10 * 60 * 1000` e passar a **derivar o timeout de `expiration_date_to`** (novo parâmetro do hook): a janela termina exatamente quando o QR expira.
- [x] 2.3 Em `src/components/impressao/TelaPagamento.tsx`, passar `expirationDateTo` ao `usePedidoStatus` para alimentar o timeout derivado (única fonte de verdade = expiração real do QR).

## 3. Timezone de Brasília no banco

- [x] 3.1 Criar `supabase/migrations/0006_timezone_brasilia.sql` com `alter database postgres set timezone to 'America/Sao_Paulo';` e comentário explicando o efeito (só exibição; `timestamptz` segue em UTC).
- [ ] 3.2 (produção) Rodar a `0006` no SQL Editor e confirmar com `show timezone;` e `select now();` (numa sessão nova).

## 4. Validação e deploy

- [x] 4.1 `npm run build` sem erros.
- [ ] 4.2 Deploy via `feat/Impressora` (Vercel de teste).
- [ ] 4.3 Testar no site: checkout oferece só "Preto e branco"; criar um PIX e conferir que o contador começa em ~30:00 **e** que a tela não cai para "Pagamento não confirmado" aos 10 min.
- [ ] 4.4 Conferir no SQL Editor que `now()` e os timestamps aparecem em horário de Brasília.
