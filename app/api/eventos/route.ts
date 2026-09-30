import { auth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { isLideranca } from "@/lib/server/admin";
import {
  EVENTO_SELECT,
  gerarOcorrencias,
  getSemestreAtivoId,
  mapEvento,
} from "@/lib/server/calendario";
import { EVENTO_STATUS_VALUES, EVENTO_FREQUENCIA_VALUES } from "@/lib/calendario/types";
import type { EventoFrequencia, EventoStatus } from "@/lib/calendario/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const url = new URL(req.url);
  const semestreId = url.searchParams.get("semestreId") ?? (await getSemestreAtivoId());
  if (!semestreId) return Response.json({ eventos: [] });

  const eventos = await prisma.evento.findMany({
    where: { semestreId },
    orderBy: { inicio: "asc" },
    select: EVENTO_SELECT,
  });

  return Response.json({ eventos: eventos.map(mapEvento) });
}

interface CreateBody {
  semestreId?: unknown;
  titulo?: unknown;
  tipoSlug?: unknown;
  status?: unknown;
  inicio?: unknown;
  fim?: unknown;
  diaTodo?: unknown;
  local?: unknown;
  linkReuniao?: unknown;
  responsavel?: unknown;
  descricao?: unknown;
  importante?: unknown;
  projetoIds?: unknown;
  frequencia?: unknown;
  repetirAte?: unknown;
}

function textoOuNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!isLideranca(session)) return Response.json({ error: "Sem permissão" }, { status: 403 });

  const body = (await req.json().catch(() => undefined)) as CreateBody | undefined;

  const titulo = typeof body?.titulo === "string" ? body.titulo.trim() : "";
  const tipoSlug = typeof body?.tipoSlug === "string" ? body.tipoSlug : "";
  const inicio =
    typeof body?.inicio === "string" && body.inicio ? new Date(body.inicio) : null;
  const fim = typeof body?.fim === "string" && body.fim ? new Date(body.fim) : null;

  if (!titulo || !tipoSlug || !inicio) {
    return Response.json({ error: "Preencha título, tipo e início" }, { status: 400 });
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

  const semestre = await prisma.semestre.findUnique({
    where: { id: semestreId },
    select: { id: true, fim: true },
  });
  if (!semestre) return Response.json({ error: "Semestre não encontrado" }, { status: 404 });

  const tipo = await prisma.tipoEvento.findUnique({ where: { slug: tipoSlug }, select: { slug: true } });
  if (!tipo) return Response.json({ error: "Tipo de evento inválido" }, { status: 400 });

  const status: EventoStatus = EVENTO_STATUS_VALUES.includes(body?.status as EventoStatus)
    ? (body?.status as EventoStatus)
    : "CONFIRMADO";
  const frequencia: EventoFrequencia = EVENTO_FREQUENCIA_VALUES.includes(
    body?.frequencia as EventoFrequencia
  )
    ? (body?.frequencia as EventoFrequencia)
    : "none";
  const diaTodo = body?.diaTodo === true;
  const importante = body?.importante === true;
  const projetoIds = Array.isArray(body?.projetoIds)
    ? body.projetoIds.filter((id): id is string => typeof id === "string")
    : [];

  const dadosComuns = {
    semestreId,
    titulo,
    diaTodo,
    tipoSlug,
    status,
    local: textoOuNull(body?.local),
    linkReuniao: textoOuNull(body?.linkReuniao),
    responsavel: textoOuNull(body?.responsavel),
    descricao: textoOuNull(body?.descricao),
    importante,
    criadoPorId: session.user.id,
    atualizadoPorId: session.user.id,
    projetos: { connect: projetoIds.map((id) => ({ id })) },
  };

  if (frequencia === "none") {
    const evento = await prisma.evento.create({
      data: { ...dadosComuns, inicio, fim },
      select: EVENTO_SELECT,
    });
    return Response.json({ eventos: [mapEvento(evento)] }, { status: 201 });
  }

  const repetirAte =
    typeof body?.repetirAte === "string" && body.repetirAte ? new Date(body.repetirAte) : null;
  if (!repetirAte) {
    return Response.json({ error: "Informe até quando repetir" }, { status: 400 });
  }

  const ocorrencias = gerarOcorrencias({
    inicio,
    fim,
    frequencia,
    repetirAte,
    semestreFim: semestre.fim,
  });
  if (ocorrencias.length === 0) {
    return Response.json({ error: "Nenhuma ocorrência cabe no período do semestre" }, {
      status: 400,
    });
  }

  const eventos = await prisma.$transaction(async (tx) => {
    const serie = await tx.eventoSerie.create({
      data: { semestreId, frequencia, repetirAte, tituloSnapshot: titulo, criadoPorId: session.user.id },
      select: { id: true },
    });

    const criados = [];
    for (const ocorrencia of ocorrencias) {
      const evento = await tx.evento.create({
        data: {
          ...dadosComuns,
          serieId: serie.id,
          ocorrenciaIndex: ocorrencia.ocorrenciaIndex,
          inicio: ocorrencia.inicio,
          fim: ocorrencia.fim,
        },
        select: EVENTO_SELECT,
      });
      criados.push(evento);
    }
    return criados;
  });

  return Response.json({ eventos: eventos.map(mapEvento) }, { status: 201 });
}
