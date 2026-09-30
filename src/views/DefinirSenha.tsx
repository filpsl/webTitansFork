"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";

import { definirSenhaSchema, DefinirSenhaFormValues } from "@/lib/definir-senha-schema";
import bixoTitans from "@/assets/bixoTitansS.png";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const DefinirSenha = ({ token }: { token: string | null }) => {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<DefinirSenhaFormValues>({
    resolver: zodResolver(definirSenhaSchema),
    defaultValues: { password: "", passwordConfirm: "" },
  });

  async function onSubmit(data: DefinirSenhaFormValues) {
    if (!token) return;
    setErro(null);
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/definir-senha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: data.password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(typeof body?.error === "string" ? body.error : "Erro ao definir senha");
        return;
      }
      setSucesso(true);
      setTimeout(() => router.push("/login"), 2000);
    } catch {
      setErro("Erro ao definir senha");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/20 to-titans-red/5 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Card className="shadow-xl border-0 bg-card/80 backdrop-blur-sm">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 w-28">
              <img
                src={bixoTitans.src}
                alt="Ícone Titans"
                className="h-full w-full origin-bottom object-contain animate-walk"
              />
            </div>
            <CardTitle className="text-xl">Defina sua senha</CardTitle>
          </CardHeader>
          <CardContent>
            {!token ? (
              <p className="text-center text-sm text-destructive">
                Link inválido — falta o token do convite.
              </p>
            ) : sucesso ? (
              <p className="text-center text-sm text-emerald-600 dark:text-emerald-400">
                Senha definida! Redirecionando pro login...
              </p>
            ) : (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nova senha</FormLabel>
                        <FormControl>
                          <Input type="password" className="h-11" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="passwordConfirm"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Confirme a senha</FormLabel>
                        <FormControl>
                          <Input type="password" className="h-11" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {erro && <p className="text-sm text-destructive text-center">{erro}</p>}

                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full h-11 bg-gradient-to-r from-titans-red to-titans-orange hover:from-titans-red/90 hover:to-titans-orange/90 text-white font-semibold"
                  >
                    {isSubmitting ? "Salvando..." : "Definir senha"}
                  </Button>
                </form>
              </Form>
            )}

            <p className="mt-6 text-center text-sm">
              <Link href="/login" className="text-titans-orange hover:text-titans-red transition-colors">
                Voltar pro login
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default DefinirSenha;
