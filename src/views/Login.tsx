"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, LoginFormValues } from "@/lib/login-schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import Header from "@/components/Header";
import bixoTitans from "@/assets/bixoTitansS.png";

const Login = () => {
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const form = useForm<LoginFormValues>({resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
      rememberMe: false,
    },
  });

  const onSubmit = async (data: LoginFormValues) => {
    setLoginError(null);
    setIsSubmitting(true);

    const result = await signIn("credentials", {
      email: data.email,
      password: data.password,
      redirect: false,
    });

    setIsSubmitting(false);

    if (result?.error) {
      setLoginError(
        result.code === "conta-inativa"
          ? "Sua conta está inativa. Fale com a liderança da equipe."
          : "E-mail ou senha inválidos."
      );
      return;
    }

    router.push("/equipe");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/20 to-titans-red/5">
      <Header />
      <div className="flex min-h-screen items-center justify-center p-4 pt-24">
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
            <CardTitle className="text-xl">Login de Membro</CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder="matricula@aluno.unb.br"
                          className="h-11"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Senha</FormLabel>
                      <div className="relative">
                        <FormControl>
                          <Input
                            type={showPassword ? "text" : "password"}
                            placeholder="Digite sua senha"
                            className="h-11 pr-10"
                            {...field}
                          />
                        </FormControl>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-11 w-10 hover:bg-transparent"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          )}
                        </Button>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex items-center justify-between text-sm">
                  <FormField
                    control={form.control}
                    name="rememberMe"
                    render={({ field }) => (
                      <FormItem className="flex items-center space-x-2 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                        <FormLabel className="cursor-pointer text-muted-foreground font-normal">
                          Lembrar de mim
                        </FormLabel>
                      </FormItem>
                    )}
                  />
                  <Link href="#" className="text-titans-orange hover:text-titans-red transition-colors">
                    Esqueci minha senha
                  </Link>
                </div>

                {loginError && (
                  <p className="text-sm text-destructive text-center">{loginError}</p>
                )}

                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full h-11 bg-gradient-to-r from-titans-red to-titans-orange hover:from-titans-red/90 hover:to-titans-orange/90 text-white font-semibold"
                >
                  {isSubmitting ? "Entrando..." : "Entrar"}
                </Button>
              </form>
            </Form>

            <div className="mt-6 text-center">
              <p className="text-sm text-muted-foreground mb-4">
                Não é membro ainda?
              </p>
              <Button variant="outline" className="w-full" asChild>
                <Link href="/#inscricoes">
                  Saiba como participar da equipe                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

          <p className="text-center text-xs text-muted-foreground mt-6">
            Área restrita aos membros da equipe
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
