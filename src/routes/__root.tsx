import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode } from "react";

import "@fontsource/open-sans/400.css";
import "@fontsource/open-sans/600.css";
import "@fontsource/open-sans/700.css";

import appCss from "../styles.css?url";
import { obterStatusConfiguracao } from "../lib/contratos.functions";
import { Toaster } from "../components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // Consultado uma vez no carregamento: sem chave da OpenAI o aplicativo não tem
  // função, então precisa avisar já na abertura em vez de falhar no meio do fluxo.
  loader: async () => await obterStatusConfiguracao(),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Gerador de Contratos Societários · Gaulke Contábil" },
      {
        name: "description",
        content:
          "Preenchimento automático de contratos societários a partir dos documentos da empresa e dos sócios.",
      },
      { name: "author", content: "Gaulke Contábil" },
      { property: "og:title", content: "Gerador de Contratos Societários · Gaulke Contábil" },
      {
        property: "og:description",
        content:
          "Preenchimento automático de contratos societários a partir dos documentos da empresa e dos sócios.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const status = Route.useLoaderData();

  return (
    <QueryClientProvider client={queryClient}>
      {status.iaConfigurada ? (
        <>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
          {!status.conversaoDocDisponivel && <AvisoConversaoIndisponivel />}
        </>
      ) : (
        <ConfiguracaoAusente />
      )}
      <Toaster richColors position="bottom-left" />
    </QueryClientProvider>
  );
}

// Sem chave da OpenAI não há extração, e sem extração o aplicativo não faz nada.
// Barramos aqui em vez de deixar o usuário subir os documentos e falhar depois.
function ConfiguracaoAusente() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-xl rounded-xl border border-destructive bg-destructive/5 p-6">
        <h1 className="text-lg font-semibold text-destructive">Configuração incompleta</h1>
        <p className="mt-2 text-sm text-foreground">
          A chave da OpenAI não está configurada. Sem ela o sistema não consegue ler os documentos,
          que é justamente o que ele faz.
        </p>
        <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            Gere uma chave em{" "}
            <span className="font-mono text-xs text-foreground">platform.openai.com/api-keys</span>.
          </li>
          <li>
            Abra o arquivo <span className="font-mono text-xs text-foreground">.env</span> na raiz
            do projeto e preencha{" "}
            <span className="font-mono text-xs text-foreground">OPENAI_API_KEY=</span>.
          </li>
          <li>Reinicie o servidor e recarregue esta página.</li>
        </ol>
        <p className="mt-4 text-xs text-muted-foreground">
          O arquivo <span className="font-mono">.env.example</span> traz todas as variáveis
          disponíveis, com explicação de cada uma.
        </p>
      </div>
    </div>
  );
}

// Não bloqueia: só modelos .doc ficam indisponíveis; .docx funciona normalmente.
function AvisoConversaoIndisponivel() {
  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-warning bg-warning/10 px-4 py-3 shadow-sm">
      <p className="text-xs text-warning-foreground">
        <strong>LibreOffice não encontrado.</strong> Modelos em <code>.doc</code> não podem ser
        convertidos neste ambiente — envie o modelo em <code>.docx</code>.
      </p>
    </div>
  );
}
