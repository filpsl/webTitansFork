"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  modelagemSchema,
  ModelagemFormValues,
  ORIGENS_CONTATO,
} from "@/lib/impressao-3d-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const FormularioModelagem = () => {
  const [enviando, setEnviando] = useState(false);
  const form = useForm<ModelagemFormValues>({
    resolver: zodResolver(modelagemSchema),
    defaultValues: {
      nome: "",
      email: "",
      telefone: "",
      descricao: "",
    },
  });

  async function onSubmit(data: ModelagemFormValues) {
    setEnviando(true);
    const toastId = toast.loading("Enviando seu pedido...");

    try {
      const res = await fetch("/api/servicos/impressao-3d", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo: "MODELAGEM", ...data }),
      });

      if (!res.ok) {
        const corpo = await res.json().catch(() => null);
        throw new Error(corpo?.error ?? "Falha ao enviar o pedido");
      }

      toast.success("Recebemos seu pedido!", {
        id: toastId,
        description: "A equipe TITANS entra em contato pelo e-mail ou telefone informado.",
      });
      form.reset();
    } catch (err) {
      console.error("Erro enviando pedido de modelagem:", err);
      toast.error("Não foi possível enviar seu pedido", {
        id: toastId,
        description: "Tente novamente ou fale com a equipe.",
      });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="nome"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nome</FormLabel>
                <FormControl>
                  <Input placeholder="Seu nome completo" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>E-mail</FormLabel>
                <FormControl>
                  <Input type="email" placeholder="voce@email.com" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="telefone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Telefone</FormLabel>
                <FormControl>
                  <Input placeholder="(61) 90000-0000" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="origem"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Por onde nos conheceu?</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione uma opção" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {ORIGENS_CONTATO.map((origem) => (
                      <SelectItem key={origem} value={origem}>
                        {origem}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="descricao"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Descreva o que você precisa</FormLabel>
              <FormControl>
                <Textarea
                  rows={5}
                  placeholder="Conte o que é a peça, para que serve, medidas aproximadas, referências, prazo desejado..."
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full sm:w-auto" disabled={enviando}>
          {enviando ? "Enviando..." : "Enviar pedido de modelagem"}
        </Button>
      </form>
    </Form>
  );
};

export default FormularioModelagem;
