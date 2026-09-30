import { prisma } from "./prisma";
import type {
  Aviso,
  AvisoSeveridade,
  Evento,
  EventoStatus,
  Semestre,
  TipoEvento,
} from "../calendario/types";

const DIA_MS = 24 * 60 * 60 * 1000;

interface GerarOcorrenciasInput {
  inicio: Date;
  fim: Date | null;
  frequencia: "semanal" | "quinzenal";
  repetirAte: Date;
  semestreFim: Date;
}

export interface Ocorrencia {
  ocorrenciaIndex: number;
  inicio: Date;
  fim: Date | null;
}

/**
 * Gera as datas de cada ocorrência de um evento recorrente, preservando a
 * duração do evento original. Porta de `recurrence.ts` do TitansCalendar,
 * adaptada pro nosso modelo (sem schemaVersion/JSON — só os campos usados).
 */
export function gerarOcorrencias({
  inicio,
  fim,
  frequencia,
  repetirAte,
  semestreFim,
}: GerarOcorrenciasInput): Ocorrencia[] {
  const intervalDias = frequencia === "quinzenal" ? 14 : 7;
  const cutoff = repetirAte.getTime() < semestreFim.getTime() ? repetirAte : semestreFim;
  const duracaoMs = fim ? fim.getTime() - inicio.getTime() : null;

  const ocorrencias: Ocorrencia[] = [];
  let atual = inicio.getTime();
  let ocorrenciaIndex = 0;
  while (atual <= cutoff.getTime()) {
    ocorrencias.push({
      ocorrenciaIndex,
      inicio: new Date(atual),
      fim: duracaoMs !== null ? new Date(atual + duracaoMs) : null,
    });
    ocorrenciaIndex += 1;
    atual += intervalDias * DIA_MS;
  }
  return ocorrencias;
}

/** Ativa um semestre e desativa qualquer outro que estivesse ativo (só um por vez). */
export async function ativarSemestre(semestreId: string): Promise<void> {
  await prisma.$transaction([
    prisma.semestre.updateMany({
      where: { ativo: true, NOT: { id: semestreId } },
      data: { ativo: false },
    }),
    prisma.semestre.update({
      where: { id: semestreId },
      data: { ativo: true, arquivadoEm: null },
    }),
  ]);
}

export async function arquivarSemestre(semestreId: string): Promise<void> {
  await prisma.semestre.update({
    where: { id: semestreId },
    data: { ativo: false, arquivadoEm: new Date() },
  });
}

export async function getSemestreAtivoId(): Promise<string | null> {
  const semestre = await prisma.semestre.findFirst({
    where: { ativo: true },
    select: { id: true },
  });
  return semestre?.id ?? null;
}

// --- Serialização (Date -> ISO) para as respostas de API ---

type SemestreRow = {
  id: string;
  nome: string;
  inicio: Date;
  fim: Date;
  ativo: boolean;
  arquivadoEm: Date | null;
};

export function mapSemestre(s: SemestreRow): Semestre {
  return {
    id: s.id,
    nome: s.nome,
    inicio: s.inicio.toISOString().slice(0, 10),
    fim: s.fim.toISOString().slice(0, 10),
    ativo: s.ativo,
    arquivadoEm: s.arquivadoEm ? s.arquivadoEm.toISOString() : null,
  };
}

type TipoEventoRow = {
  slug: string;
  label: string;
  corToken: string;
  iconeKey: string;
  ordem: number;
};

export function mapTipoEvento(t: TipoEventoRow): TipoEvento {
  return { slug: t.slug, label: t.label, corToken: t.corToken, iconeKey: t.iconeKey, ordem: t.ordem };
}

type EventoRow = {
  id: string;
  semestreId: string;
  serieId: string | null;
  ocorrenciaIndex: number | null;
  titulo: string;
  inicio: Date;
  fim: Date | null;
  diaTodo: boolean;
  tipoSlug: string;
  status: EventoStatus;
  local: string | null;
  linkReuniao: string | null;
  responsavel: string | null;
  descricao: string | null;
  notaAlteracao: string | null;
  alteracaoVisivelAte: Date | null;
  importante: boolean;
  createdAt: Date;
  updatedAt: Date;
  projetos: { id: string }[];
};

export function mapEvento(e: EventoRow): Evento {
  return {
    id: e.id,
    semestreId: e.semestreId,
    serieId: e.serieId,
    ocorrenciaIndex: e.ocorrenciaIndex,
    titulo: e.titulo,
    inicio: e.inicio.toISOString(),
    fim: e.fim ? e.fim.toISOString() : null,
    diaTodo: e.diaTodo,
    tipoSlug: e.tipoSlug,
    status: e.status,
    local: e.local,
    linkReuniao: e.linkReuniao,
    responsavel: e.responsavel,
    descricao: e.descricao,
    notaAlteracao: e.notaAlteracao,
    alteracaoVisivelAte: e.alteracaoVisivelAte ? e.alteracaoVisivelAte.toISOString() : null,
    importante: e.importante,
    projetoIds: e.projetos.map((p) => p.id),
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

type AvisoRow = {
  id: string;
  semestreId: string;
  titulo: string;
  corpo: string;
  severidade: AvisoSeveridade;
  inicio: Date;
  fim: Date | null;
  eventoId: string | null;
  publicado: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export function mapAviso(a: AvisoRow): Aviso {
  return {
    id: a.id,
    semestreId: a.semestreId,
    titulo: a.titulo,
    corpo: a.corpo,
    severidade: a.severidade,
    inicio: a.inicio.toISOString(),
    fim: a.fim ? a.fim.toISOString() : null,
    eventoId: a.eventoId,
    publicado: a.publicado,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export const EVENTO_SELECT = {
  id: true,
  semestreId: true,
  serieId: true,
  ocorrenciaIndex: true,
  titulo: true,
  inicio: true,
  fim: true,
  diaTodo: true,
  tipoSlug: true,
  status: true,
  local: true,
  linkReuniao: true,
  responsavel: true,
  descricao: true,
  notaAlteracao: true,
  alteracaoVisivelAte: true,
  importante: true,
  createdAt: true,
  updatedAt: true,
  projetos: { select: { id: true } },
} as const;

export const AVISO_SELECT = {
  id: true,
  semestreId: true,
  titulo: true,
  corpo: true,
  severidade: true,
  inicio: true,
  fim: true,
  eventoId: true,
  publicado: true,
  createdAt: true,
  updatedAt: true,
} as const;
