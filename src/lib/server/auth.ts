// Re-exporta o auth.ts da raiz (fora de src/) com um caminho estável via
// alias "@/*", pra rotas de API não terem que contar "../" pela profundidade.
export { auth, signIn, signOut, handlers } from "../../../auth";
