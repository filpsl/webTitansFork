import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Cliente admin (chave secreta, bypassa RLS) do projeto Supabase da camada
// TITANS — usado só para ler de volta os objetos do Storage (bucket
// `arquivos-3d`) e anexá-los no e-mail de aviso da equipe. A tabela
// `pedidos_3d` NÃO passa por aqui — é acessada via Prisma
// (src/lib/server/prisma.ts). Distinto do projeto legado da camada
// IMPRESSORA (src/lib/server/supabase-admin.ts). Inicialização preguiçosa: o
// `next build` importa este módulo ao coletar os dados das rotas, mas as envs
// só existem em runtime.
let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_TITANS_URL;
  const secretKey = process.env.SUPABASE_TITANS_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error(
      "SUPABASE_TITANS_URL e SUPABASE_TITANS_SECRET_KEY precisam estar definidas nas envs da Vercel"
    );
  }

  client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

// Proxy mantém a API `supabaseAdminTitans.storage` sem instanciar o client
// até o primeiro acesso.
export const supabaseAdminTitans = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const c = getClient();
    const value = Reflect.get(c, prop, receiver);
    return typeof value === "function" ? value.bind(c) : value;
  },
});
