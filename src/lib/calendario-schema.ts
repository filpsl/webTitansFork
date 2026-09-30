import * as z from "zod";
import {
  EVENTO_STATUS_VALUES,
  AVISO_SEVERIDADE_VALUES,
  EVENTO_FREQUENCIA_VALUES,
} from "./calendario/types";

export const eventoSchema = z
  .object({
    titulo: z.string().min(3, "Digite um título."),
    tipoSlug: z.string().min(1, "Selecione um tipo."),
    status: z.enum(EVENTO_STATUS_VALUES),
    diaTodo: z.boolean(),
    dataInicio: z.string().min(1, "Informe a data de início."),
    horaInicio: z.string().optional(),
    dataFim: z.string().optional(),
    horaFim: z.string().optional(),
    local: z.string().optional(),
    linkReuniao: z
      .string()
      .optional()
      .refine((v) => !v || /^https?:\/\//.test(v), "Use uma URL http:// ou https://."),
    responsavel: z.string().optional(),
    descricao: z.string().optional(),
    importante: z.boolean(),
    frequencia: z.enum(EVENTO_FREQUENCIA_VALUES),
    repetirAte: z.string().optional(),
    projetoIds: z.array(z.string()),
  })
  .refine((data) => data.diaTodo || !!data.horaInicio, {
    message: "Informe o horário inicial.",
    path: ["horaInicio"],
  })
  .refine((data) => data.frequencia === "none" || !!data.repetirAte, {
    message: "Informe até quando repetir.",
    path: ["repetirAte"],
  });

export type EventoFormValues = z.infer<typeof eventoSchema>;

export const avisoSchema = z.object({
  titulo: z.string().min(3, "Digite um título."),
  corpo: z.string().min(3, "Escreva a mensagem do aviso."),
  severidade: z.enum(AVISO_SEVERIDADE_VALUES),
  dataInicio: z.string().min(1, "Informe a data de início."),
  dataFim: z.string().optional(),
  publicado: z.boolean(),
});

export type AvisoFormValues = z.infer<typeof avisoSchema>;

export const semestreSchema = z
  .object({
    nome: z.string().min(3, "Digite um nome (ex.: 2026.1)."),
    inicio: z.string().min(1, "Informe a data de início."),
    fim: z.string().min(1, "Informe a data de fim."),
  })
  .refine((data) => new Date(data.fim) > new Date(data.inicio), {
    message: "A data de fim precisa ser depois do início.",
    path: ["fim"],
  });

export type SemestreFormValues = z.infer<typeof semestreSchema>;
