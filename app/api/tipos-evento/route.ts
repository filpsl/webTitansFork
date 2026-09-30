import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { mapTipoEvento } from "@/lib/server/calendario";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const tipos = await prisma.tipoEvento.findMany({
    where: { ativo: true },
    orderBy: { ordem: "asc" },
    select: { slug: true, label: true, corToken: true, iconeKey: true, ordem: true },
  });

  return Response.json({ tipos: tipos.map(mapTipoEvento) });
}
