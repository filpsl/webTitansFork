"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  feedbackImpressoraSchema,
  PONTO_MELHORAR_LABELS,
  PONTO_MELHORAR_VALUES,
  type FeedbackImpressoraFormValues,
} from "@/lib/feedback-impressora-schema";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

const ESCALA_VALUES = [0, 1, 2, 3, 4, 5] as const;

const scaleQuestions = [
  { name: "facilidadeUpload", label: "1. Como você avalia a facilidade de enviar seu PDF pelo nosso site?" },
  { name: "experienciaPagamento", label: "2. Como foi a sua experiência com a etapa de pagamento?" },
  {
    name: "recomendaria",
    label: "3. O quanto você recomendaria o nosso serviço de impressão para outros estudantes?",
  },
] as const;

const simNaoQuestions = [
  {
    name: "dificuldadeUpload",
    detalheName: "dificuldadeUploadDetalhe",
    label: "4. Você encontrou alguma dificuldade, lentidão ou erro ao fazer o upload do seu documento?",
    // "sim" é a resposta ruim aqui — a pergunta é sobre ter encontrado um problema.
    valorRuim: "sim",
    detalhePlaceholder: "O que aconteceu?",
  },
  {
    name: "informacoesClaras",
    detalheName: "informacoesClarasDetalhe",
    label: "5. As informações no site (preços, instruções de retirada e etc) estavam claras?",
    valorRuim: "nao",
    detalhePlaceholder: "O que ficou confuso?",
  },
  {
    name: "localRetiradaFacil",
    detalheName: "localRetiradaFacilDetalhe",
    label: "6. Foi fácil localizar o local de retirada das folhas?",
    valorRuim: "nao",
    detalhePlaceholder: "O que dificultou?",
  },
  {
    name: "impressoraIntuitiva",
    detalheName: "impressoraIntuitivaDetalhe",
    label:
      "7. Na primeira vez que você foi buscar as suas folhas, você encontrou a impressora logo de cara? Foi intuitivo?",
    valorRuim: "nao",
    detalhePlaceholder: "O que faltou pra ficar mais claro?",
  },
  {
    name: "qualidadeImpressao",
    detalheName: "qualidadeImpressaoDetalhe",
    label:
      "8. A impressão estava com a qualidade esperada e no formato correto (margens, frente e verso, etc.)?",
    valorRuim: "nao",
    detalhePlaceholder: "O que saiu errado?",
  },
] as const;

export function FeedbackImpressoraForm() {
  const form = useForm<FeedbackImpressoraFormValues>({
    resolver: zodResolver(feedbackImpressoraSchema),
    defaultValues: {
      dificuldadeUploadDetalhe: "",
      informacoesClarasDetalhe: "",
      localRetiradaFacilDetalhe: "",
      impressoraIntuitivaDetalhe: "",
      qualidadeImpressaoDetalhe: "",
      pontoMelhorarOutro: "",
      comentarios: "",
    },
  });

  async function onSubmit(data: FeedbackImpressoraFormValues) {
    const toastId = toast.loading("Enviando seu feedback...");

    try {
      const res = await fetch("/api/feedback-impressora", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const resposta = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof resposta?.error === "string" ? resposta.error : "Erro ao enviar");
      }

      toast.success("Feedback enviado com sucesso!", {
        id: toastId,
        description: "Obrigado por nos ajudar a melhorar o serviço de impressão.",
      });
      form.reset();
    } catch (error) {
      toast.error("Erro ao enviar o feedback", {
        id: toastId,
        description: "Tente novamente em instantes.",
      });
      console.error("Erro ao enviar feedback de impressora:", error);
    }
  }

  const pontoMelhorar = form.watch("pontoMelhorar");

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        {scaleQuestions.map((q) => (
          <FormField
            key={q.name}
            control={form.control}
            name={q.name}
            render={({ field }) => (
              <FormItem className="space-y-4">
                <FormLabel className="text-lg font-medium">{q.label}</FormLabel>
                <FormControl>
                  <RadioGroup
                    onValueChange={field.onChange}
                    value={field.value}
                    className="flex justify-between sm:justify-start sm:gap-8"
                  >
                    {ESCALA_VALUES.map((val) => (
                      <div key={val} className="flex flex-col items-center space-y-2">
                        <RadioGroupItem value={val.toString()} id={`${q.name}-${val}`} />
                        <label htmlFor={`${q.name}-${val}`} className="text-sm cursor-pointer">
                          {val}
                        </label>
                      </div>
                    ))}
                  </RadioGroup>
                </FormControl>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>0 — Muito ruim/difícil</span>
                  <span>5 — Muito bom/fácil</span>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}

        {simNaoQuestions.map((q) => {
          const resposta = form.watch(q.name);
          return (
            <div key={q.name} className="space-y-4">
              <FormField
                control={form.control}
                name={q.name}
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel className="text-lg font-medium">{q.label}</FormLabel>
                    <FormControl>
                      <RadioGroup onValueChange={field.onChange} value={field.value} className="flex gap-6">
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="sim" id={`${q.name}-sim`} />
                          <label htmlFor={`${q.name}-sim`} className="text-sm cursor-pointer">
                            Sim
                          </label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="nao" id={`${q.name}-nao`} />
                          <label htmlFor={`${q.name}-nao`} className="text-sm cursor-pointer">
                            Não
                          </label>
                        </div>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {resposta === q.valorRuim && (
                <FormField
                  control={form.control}
                  name={q.detalheName}
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Textarea placeholder={q.detalhePlaceholder} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>
          );
        })}

        <FormField
          control={form.control}
          name="pontoMelhorar"
          render={({ field }) => (
            <FormItem className="space-y-3">
              <FormLabel className="text-lg font-medium text-left block">
                9. Na sua opinião, qual é o ponto que mais precisamos melhorar no nosso sistema?
              </FormLabel>
              <FormControl>
                <RadioGroup onValueChange={field.onChange} value={field.value} className="space-y-2">
                  {PONTO_MELHORAR_VALUES.map((valor) => (
                    <div key={valor} className="flex items-center space-x-2">
                      <RadioGroupItem value={valor} id={`pontoMelhorar-${valor}`} />
                      <label htmlFor={`pontoMelhorar-${valor}`} className="text-sm cursor-pointer">
                        {PONTO_MELHORAR_LABELS[valor]}
                      </label>
                    </div>
                  ))}
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {pontoMelhorar === "outro" && (
          <FormField
            control={form.control}
            name="pontoMelhorarOutro"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input placeholder="Qual?" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="comentarios"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-lg font-medium text-left block">
                10. Tem mais algum comentário, crítica ou sugestão para a equipe? (Opcional)
              </FormLabel>
              <FormControl>
                <Textarea rows={5} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full h-12 text-lg font-semibold">
          Enviar Feedback
        </Button>
      </form>
    </Form>
  );
}
