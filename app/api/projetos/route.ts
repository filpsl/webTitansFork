import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const projetos = await prisma.projeto.findMany({
    orderBy: { nome: "asc" },
    select: { id: true, nome: true },
  });
  return Response.json({ projetos });
}
