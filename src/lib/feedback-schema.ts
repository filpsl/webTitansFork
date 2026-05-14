import * as z from "zod";

export const feedbackSchema = z.object({
  // Escalas de 1 a 5 (tratadas como string pelo RadioGroup)
  welcomed: z.enum(["1", "2", "3", "4", "5"], { required_error: "Selecione uma opção" }),
  communication: z.enum(["1", "2", "3", "4", "5"], { required_error: "Selecione uma opção" }),
  responsibilities: z.enum(["1", "2", "3", "4", "5"], { required_error: "Selecione uma opção" }),
  learning: z.enum(["1", "2", "3", "4", "5"], { required_error: "Selecione uma opção" }),
  organization: z.enum(["1", "2", "3", "4", "5"], { required_error: "Selecione uma opção" }),
  
  // Respostas curtas (mínimo 3 caracteres para evitar respostas vazias)
  workingWell: z.string().min(3, "Por favor, escreva um pouco mais."),
  toImprove: z.string().min(3, "Por favor, detalhe o que pode melhorar."),
  
  // Resposta longa opcional
  comments: z.string().optional(),
});

export type FeedbackFormValues = z.infer<typeof feedbackSchema>;