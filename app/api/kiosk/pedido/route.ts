import { supabaseAdmin } from "@/lib/server/supabase-admin";

// Consulta de pedido por protocolo para o kiosk. Server-side (service_role)
// para nunca expor o UUID completo — ele funciona como token de leitura do
// pedido — nem permitir varredura de índice pelo anon.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROTOCOLO_RE = /^[0-9a-fA-F]{8}$/;

// O protocolo são os 8 primeiros hex do UUID (primeiro grupo inteiro), então
// ele define um intervalo fechado de UUIDs — a comparação de uuid no Postgres
// é byte a byte. Evita RPC/cast: PostgREST não filtra `like` em coluna uuid.
function intervaloDoProtocolo(protocolo: string): { de: string; ate: string } {
  const p = protocolo.toLowerCase();
  return {
    de: `${p}-0000-0000-0000-000000000000`,
    ate: `${p}-ffff-ffff-ffff-ffffffffffff`,
  };
}

export async function GET(req: Request) {
  const protocolo = new URL(req.url).searchParams.get("protocolo");
  if (!protocolo || !PROTOCOLO_RE.test(protocolo)) {
    return Response.json(
      { error: "protocolo inválido — 8 caracteres hexadecimais" },
      { status: 400 }
    );
  }

  const { de, ate } = intervaloDoProtocolo(protocolo);

  // Colisão de prefixo (improvável): resolve pelo pedido mais recente.
  const { data: pedido, error } = await supabaseAdmin
    .from("fila_impressao")
    .select("status, paid_at, printed_at, created_at")
    .gte("id", de)
    .lte("id", ate)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Erro buscando pedido por protocolo:", error);
    return Response.json({ error: "Erro interno" }, { status: 500 });
  }
  if (!pedido) {
    return Response.json({ error: "Pedido não encontrado" }, { status: 404 });
  }

  // Posição na fila (1-based, FIFO por paid_at — mesmo critério do worker):
  // quantos pedidos ativos foram pagos até este, inclusive ele.
  let posicaoNaFila: number | null = null;
  if (pedido.status === "PAGO" && pedido.paid_at) {
    const { count, error: countError } = await supabaseAdmin
      .from("fila_impressao")
      .select("id", { count: "exact", head: true })
      .in("status", ["PAGO", "IMPRIMINDO"])
      .lte("paid_at", pedido.paid_at);
    if (countError) {
      console.error("Erro contando posição na fila:", countError);
    } else {
      posicaoNaFila = count;
    }
  }

  return Response.json({
    status: pedido.status,
    paid_at: pedido.paid_at,
    printed_at: pedido.printed_at,
    posicao_na_fila: posicaoNaFila,
  });
}
