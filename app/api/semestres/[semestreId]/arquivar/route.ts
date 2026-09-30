import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { isLideranca } from "@/lib/server/admin";
import { arquivarSemestre } from "@/lib/server/calendario";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ semestreId: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!isLideranca(session)) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const { semestreId } = await params;

  const semestre = await prisma.semestre.findUnique({
    where: { id: semestreId },
    select: { id: true, ativo: true },
  });
  if (!semestre) return Response.json({ error: "Semestre não encontrado" }, { status: 404 });
  if (!semestre.ativo) {
    return Response.json({ error: "Esse semestre já não está ativo" }, { status: 400 });
  }

  await arquivarSemestre(semestreId);
  return Response.json({ ok: true });
}
