import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const inicio = Date.now();
  const resultado = await prisma.$queryRaw<{ bytes: number | bigint | string }[]>`
    SELECT pg_database_size(current_database()) AS bytes
  `;
  const latenciaMs = Date.now() - inicio;
  const dbSizeBytes = Number(resultado[0]?.bytes ?? 0);

  return Response.json({ dbSizeBytes, latenciaMs });
}
