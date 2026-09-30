import * as z from "zod";

export const definirSenhaSchema = z
  .object({
    password: z.string().min(8, "A senha precisa ter ao menos 8 caracteres."),
    passwordConfirm: z.string().min(1, "Confirme sua senha."),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: "As senhas não coincidem.",
    path: ["passwordConfirm"],
  });

export type DefinirSenhaFormValues = z.infer<typeof definirSenhaSchema>;
