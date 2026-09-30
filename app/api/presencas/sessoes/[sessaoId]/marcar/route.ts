import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { isGerenteOuSuperior } from "@/lib/server/admin";
import { PRESENCA_STATUS_VALUES } from "@/lib/presencas/types";
import type { PresencaStatus } from "@/lib/presencas/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MarcarBody {
  membroId?: unknown;
  /** null/vazio desmarca a célula (volta a "sem registro"). */
  status?: unknown;
  observacao?: unknown;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sessaoId: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!isGerenteOuSuperior(session)) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const { sessaoId } = await params;
  const sessao = await prisma.sessaoPresenca.findUnique({
    where: { id: sessaoId },
    select: { id: true, projetoId: true },
  });
  if (!sessao) return Response.json({ error: "Sessão não encontrada" }, { status: 404 });

  const body = (await req.json().catch(() => undefined)) as MarcarBody | undefined;
  const membroId = typeof body?.membroId === "string" ? body.membroId : "";
  if (!membroId) return Response.json({ error: "Informe o membro" }, { status: 400 });

  const membroNoProjeto = await prisma.projeto.findFirst({
    where: { id: sessao.projetoId, membros: { some: { id: membroId } } },
    select: { id: true },
  });
  if (!membroNoProjeto) {
    return Response.json({ error: "Esse membro não participa desse projeto" }, { status: 400 });
  }

  if (!body?.status) {
    await prisma.presenca.deleteMany({ where: { sessaoId, membroId } });
    return Response.json({ ok: true, presenca: null });
  }

  if (!PRESENCA_STATUS_VALUES.includes(body.status as PresencaStatus)) {
    return Response.json({ error: "Status inválido" }, { status: 400 });
  }
  const status = body.status as PresencaStatus;
  const observacao =
    typeof body?.observacao === "string" && body.observacao.trim() ? body.observacao.trim() : null;

  const presenca = await prisma.presenca.upsert({
    where: { sessaoId_membroId: { sessaoId, membroId } },
    create: { sessaoId, membroId, status, observacao, registradoPorId: session.user.id },
    update: { status, observacao, registradoPorId: session.user.id },
    select: { membroId: true, status: true, observacao: true },
  });

  return Response.json({ ok: true, presenca: { sessaoId, ...presenca } });
}
