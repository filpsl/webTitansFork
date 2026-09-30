export const EVENTO_STATUS_VALUES = [
  "CONFIRMADO",
  "PENDENTE",
  "ALTERADO",
  "CANCELADO",
  "CONCLUIDO",
] as const;
export type EventoStatus = (typeof EVENTO_STATUS_VALUES)[number];

export const AVISO_SEVERIDADE_VALUES = ["INFO", "ALERTA", "CRITICO"] as const;
export type AvisoSeveridade = (typeof AVISO_SEVERIDADE_VALUES)[number];

/** "none" não gera EventoSerie — é só o evento único criado. */
export const EVENTO_FREQUENCIA_VALUES = ["none", "semanal", "quinzenal"] as const;
export type EventoFrequencia = (typeof EVENTO_FREQUENCIA_VALUES)[number];

export interface TipoEvento {
  slug: string;
  label: string;
  corToken: string;
  iconeKey: string;
  ordem: number;
}

export interface Semestre {
  id: string;
  nome: string;
  /** Datas em ISO (yyyy-MM-dd). */
  inicio: string;
  fim: string;
  ativo: boolean;
  arquivadoEm: string | null;
}

export interface Evento {
  id: string;
  semestreId: string;
  serieId: string | null;
  ocorrenciaIndex: number | null;
  titulo: string;
  /** Datas/horas em ISO 8601 completo. */
  inicio: string;
  fim: string | null;
  diaTodo: boolean;
  tipoSlug: string;
  status: EventoStatus;
  local: string | null;
  linkReuniao: string | null;
  responsavel: string | null;
  descricao: string | null;
  notaAlteracao: string | null;
  alteracaoVisivelAte: string | null;
  importante: boolean;
  projetoIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Aviso {
  id: string;
  semestreId: string;
  titulo: string;
  corpo: string;
  severidade: AvisoSeveridade;
  inicio: string;
  fim: string | null;
  eventoId: string | null;
  publicado: boolean;
  createdAt: string;
  updatedAt: string;
}

interface SeveridadeMeta {
  label: string;
  /** Classes para badge/borda — legíveis em light e dark. */
  className: string;
}

export const SEVERIDADE_META: Record<AvisoSeveridade, SeveridadeMeta> = {
  INFO: {
    label: "Informativo",
    className: "border-l-4 border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  ALERTA: {
    label: "Atenção",
    className: "border-l-4 border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  CRITICO: {
    label: "Urgente",
    className:
      "border-l-4 border-destructive bg-destructive/10 text-destructive dark:text-red-300",
  },
};
