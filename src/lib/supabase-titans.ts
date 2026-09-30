import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Cliente do projeto Supabase da camada TITANS — SEPARADO do projeto legado da
// camada IMPRESSORA (src/lib/supabase.ts), que continua servindo o
// web-to-print/kiosk existentes. Usado pelas features novas que sobem arquivo
// direto pro Storage a partir do navegador (ex.: pedidos_3d / bucket
// arquivos-3d). Inicialização preguiçosa, mesmo padrão do
// src/lib/server/supabase-admin-titans.ts: o `next build` importa este módulo
// ao coletar/prerenderizar as páginas, mas as envs podem não existir nesse
// ambiente (ex.: CI sem os secrets do Supabase) — só falha de verdade quando
// o código tentar usar o client de fato, não ao importar o módulo.
let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_TITANS_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_TITANS_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_TITANS_URL e NEXT_PUBLIC_SUPABASE_TITANS_PUBLISHABLE_KEY precisam estar definidas no .env.local"
    );
  }

  client = createClient(url, publishableKey, { auth: { persistSession: false } });
  return client;
}

// Proxy mantém a API `supabaseTitans.storage`/etc. sem instanciar o client
// até o primeiro acesso de verdade.
export const supabaseTitans = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const c = getClient();
    const value = Reflect.get(c, prop, receiver);
    return typeof value === "function" ? value.bind(c) : value;
  },
});
