import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { isGerenteOuSuperior } from "@/lib/server/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ sessaoId: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!isGerenteOuSuperior(session)) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const { sessaoId } = await params;
  const existente = await prisma.sessaoPresenca.findUnique({
    where: { id: sessaoId },
    select: { id: true },
  });
  if (!existente) return Response.json({ error: "Sessão não encontrada" }, { status: 404 });

  await prisma.sessaoPresenca.delete({ where: { id: sessaoId } });
  return Response.json({ ok: true });
}
