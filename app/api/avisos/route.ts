import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { isLideranca } from "@/lib/server/admin";
import { AVISO_SELECT, getSemestreAtivoId, mapAviso } from "@/lib/server/calendario";
import { AVISO_SEVERIDADE_VALUES } from "@/lib/calendario/types";
import type { AvisoSeveridade } from "@/lib/calendario/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const semestreId = await getSemestreAtivoId();
  if (!semestreId) return Response.json({ avisos: [] });

  const lideranca = isLideranca(session);
  const agora = new Date();

  const avisos = await prisma.aviso.findMany({
    where: {
      semestreId,
      // Liderança vê tudo (inclusive rascunhos); demais membros só o publicado e dentro da janela.
      ...(lideranca
        ? {}
        : {
            publicado: true,
            inicio: { lte: agora },
            OR: [{ fim: null }, { fim: { gte: agora } }],
          }),
    },
    orderBy: { inicio: "desc" },
    select: AVISO_SELECT,
  });

  return Response.json({ avisos: avisos.map(mapAviso) });
}

interface CreateBody {
  semestreId?: unknown;
  titulo?: unknown;
  corpo?: unknown;
  severidade?: unknown;
  inicio?: unknown;
  fim?: unknown;
  eventoId?: unknown;
  publicado?: unknown;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!isLideranca(session)) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const body = (await req.json().catch(() => undefined)) as CreateBody | undefined;

  const titulo = typeof body?.titulo === "string" ? body.titulo.trim() : "";
  const corpo = typeof body?.corpo === "string" ? body.corpo.trim() : "";
  if (!titulo || !corpo) {
    return Response.json({ error: "Preencha título e mensagem" }, { status: 400 });
  }

  const semestreId =
    typeof body?.semestreId === "string" && body.semestreId
      ? body.semestreId
      : await getSemestreAtivoId();
  if (!semestreId) {
    return Response.json({ error: "Nenhum semestre ativo — crie e ative um primeiro" }, {
      status: 400,
    });
  }

  const severidade: AvisoSeveridade = AVISO_SEVERIDADE_VALUES.includes(
    body?.severidade as AvisoSeveridade
  )
    ? (body?.severidade as AvisoSeveridade)
    : "INFO";
  const inicio =
    typeof body?.inicio === "string" && body.inicio ? new Date(body.inicio) : new Date();
  const fim = typeof body?.fim === "string" && body.fim ? new Date(body.fim) : null;
  const eventoId = typeof body?.eventoId === "string" && body.eventoId ? body.eventoId : null;
  const publicado = body?.publicado === true;

  const aviso = await prisma.aviso.create({
    data: {
      semestreId,
      titulo,
      corpo,
      severidade,
      inicio,
      fim,
      eventoId,
      publicado,
      criadoPorId: session.user.id,
      atualizadoPorId: session.user.id,
    },
    select: AVISO_SELECT,
  });

  return Response.json({ aviso: mapAviso(aviso) }, { status: 201 });
}
