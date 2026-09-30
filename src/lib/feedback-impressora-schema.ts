import * as z from "zod";

const ESCALA_VALUES = ["0", "1", "2", "3", "4", "5"] as const;
const SIM_NAO_VALUES = ["sim", "nao"] as const;

export const PONTO_MELHORAR_VALUES = [
  "layout",
  "pagamento",
  "retirada",
  "qualidade",
  "outro",
] as const;

export const PONTO_MELHORAR_LABELS: Record<(typeof PONTO_MELHORAR_VALUES)[number], string> = {
  layout: "O layout e a facilidade do site",
  pagamento: "Opções ou processo de pagamento",
  retirada: "A facilidade para encontrar a equipe e retirar as folhas",
  qualidade: "Qualidade da impressão ou do papel",
  outro: "Outro",
};

const escala = z.enum(ESCALA_VALUES, { required_error: "Selecione uma nota" });
const simNao = z.enum(SIM_NAO_VALUES, { required_error: "Selecione uma opção" });

export const feedbackImpressoraSchema = z
  .object({
    facilidadeUpload: escala,
    experienciaPagamento: escala,
    recomendaria: escala,

    dificuldadeUpload: simNao,
    dificuldadeUploadDetalhe: z.string().optional(),

    informacoesClaras: simNao,
    informacoesClarasDetalhe: z.string().optional(),

    localRetiradaFacil: simNao,
    localRetiradaFacilDetalhe: z.string().optional(),

    impressoraIntuitiva: simNao,
    impressoraIntuitivaDetalhe: z.string().optional(),

    qualidadeImpressao: simNao,
    qualidadeImpressaoDetalhe: z.string().optional(),

    pontoMelhorar: z.enum(PONTO_MELHORAR_VALUES, { required_error: "Selecione uma opção" }),
    pontoMelhorarOutro: z.string().optional(),

    comentarios: z.string().optional(),
  })
  // Caixa de texto obrigatória sempre que a resposta indicar uma experiência ruim.
  .superRefine((data, ctx) => {
    if (data.dificuldadeUpload === "sim" && !data.dificuldadeUploadDetalhe?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dificuldadeUploadDetalhe"],
        message: "Conte um pouco mais sobre o que aconteceu.",
      });
    }
    if (data.informacoesClaras === "nao" && !data.informacoesClarasDetalhe?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["informacoesClarasDetalhe"],
        message: "O que ficou confuso?",
      });
    }
    if (data.localRetiradaFacil === "nao" && !data.localRetiradaFacilDetalhe?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["localRetiradaFacilDetalhe"],
        message: "Conte o que dificultou.",
      });
    }
    if (data.impressoraIntuitiva === "nao" && !data.impressoraIntuitivaDetalhe?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["impressoraIntuitivaDetalhe"],
        message: "O que faltou pra ficar mais claro?",
      });
    }
    if (data.qualidadeImpressao === "nao" && !data.qualidadeImpressaoDetalhe?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["qualidadeImpressaoDetalhe"],
        message: "O que saiu errado?",
      });
    }
    if (data.pontoMelhorar === "outro" && !data.pontoMelhorarOutro?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pontoMelhorarOutro"],
        message: "Descreva o que precisa melhorar.",
      });
    }
  });

export type FeedbackImpressoraFormValues = z.infer<typeof feedbackImpressoraSchema>;
