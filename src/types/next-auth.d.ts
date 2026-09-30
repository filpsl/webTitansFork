import type { DefaultSession } from "next-auth";
import type { Role } from "../../generated/prisma/enums";

declare module "next-auth" {
  interface User {
    role: Role;
  }

  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
  }
}

// `next-auth/jwt` só faz `export * from "@auth/core/jwt"` — o augmentation
// acima não atravessa esse re-export, então precisa mirar o módulo original
// também (é de lá que os tipos internos do callback `session` importam JWT).
declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: Role;
  }
}
