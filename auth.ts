import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/server/prisma";
import { loginSchema } from "@/lib/login-schema";
import { registrarLog } from "@/lib/server/log";

/** Lançado quando o membro existe e a senha bate, mas o status dele é INATIVO. */
export class ContaInativaError extends CredentialsSignin {
  code = "conta-inativa";
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  // O Credentials provider só funciona com sessão em JWT — Auth.js rejeita
  // (UnsupportedStrategy) combiná-lo com sessão em banco. O PrismaAdapter
  // fica mantido mesmo assim: não faz nada com Credentials hoje, mas já
  // deixa Account/Session prontos pro dia que entrar login social (Google etc).
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      authorize: async (credentials, request) => {
        const parsed = loginSchema
          .pick({ email: true, password: true })
          .safeParse(credentials);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        });
        if (!user) {
          await registrarLog({
            usuarioEmail: parsed.data.email,
            categoria: "AUTENTICACAO",
            acao: "login_falha",
            descricao: `Tentativa de login com e-mail não cadastrado (${parsed.data.email})`,
            request,
          });
          return null;
        }

        const senhaValida = await bcrypt.compare(parsed.data.password, user.password);
        if (!senhaValida) {
          await registrarLog({
            usuarioId: user.id,
            usuarioNome: user.nome,
            usuarioEmail: user.email,
            categoria: "AUTENTICACAO",
            acao: "login_falha",
            descricao: "Tentativa de login com senha incorreta",
            request,
          });
          return null;
        }

        if (user.status === "INATIVO") {
          await registrarLog({
            usuarioId: user.id,
            usuarioNome: user.nome,
            usuarioEmail: user.email,
            categoria: "AUTENTICACAO",
            acao: "login_bloqueado",
            descricao: "Tentativa de login bloqueada — conta inativa",
            request,
          });
          throw new ContaInativaError();
        }

        await registrarLog({
          usuarioId: user.id,
          usuarioNome: user.nome,
          usuarioEmail: user.email,
          categoria: "AUTENTICACAO",
          acao: "login_sucesso",
          descricao: "Login realizado com sucesso",
          request,
        });

        return {
          id: user.id,
          email: user.email,
          name: user.nome,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      return session;
    },
  },
  events: {
    // Sessão em JWT (não banco) — a única forma de "quem desconectou" aparecer
    // no log é aqui. Sem Request nesse hook, então sem IP/user-agent.
    async signOut(message) {
      if (!("token" in message) || !message.token) return;
      await registrarLog({
        usuarioId: message.token.id,
        usuarioNome: message.token.name,
        usuarioEmail: message.token.email,
        categoria: "AUTENTICACAO",
        acao: "logout",
        descricao: "Encerrou a sessão",
      });
    },
  },
});
