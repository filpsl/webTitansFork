import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { isLideranca } from "@/lib/server/admin";
import { EVENTO_SELECT, mapEvento } from "@/lib/server/calendario";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CancelarBody {
  notaAlteracao?: unknown;
  alteracaoVisivelAte?: unknown;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!isLideranca(session)) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const { eventoId } = await params;
  const existente = await prisma.evento.findUnique({ where: { id: eventoId }, select: { id: true } });
  if (!existente) return Response.json({ error: "Evento não encontrado" }, { status: 404 });

  const body = (await req.json().catch(() => undefined)) as CancelarBody | undefined;
  const notaAlteracao =
    typeof body?.notaAlteracao === "string" && body.notaAlteracao.trim()
      ? body.notaAlteracao.trim()
      : null;
  const alteracaoVisivelAte =
    typeof body?.alteracaoVisivelAte === "string" && body.alteracaoVisivelAte
      ? new Date(body.alteracaoVisivelAte)
      : null;

  const evento = await prisma.evento.update({
    where: { id: eventoId },
    data: {
      status: "CANCELADO",
      notaAlteracao,
      alteracaoVisivelAte,
      atualizadoPorId: session.user.id,
    },
    select: EVENTO_SELECT,
  });

  return Response.json({ evento: mapEvento(evento) });
}
