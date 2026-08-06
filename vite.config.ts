import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ command, mode }) => {
  // O Vite injeta VITE_* só no bundle do cliente; isto estende para o SSR/nitro.
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const envDefine = Object.fromEntries(
    Object.entries(env).map(([chave, valor]) => [
      `import.meta.env.${chave}`,
      JSON.stringify(valor),
    ]),
  );

  return {
    define: envDefine,

    // O padrão do Vite 8 é "postcss". Manter lightningcss preserva exatamente o
    // CSS que o projeto vinha gerando — styles.css usa @theme inline,
    // @custom-variant e color-mix, onde a diferença de transformador aparece.
    css: { transformer: "lightningcss" },

    resolve: {
      alias: { "@": `${process.cwd()}/src` },
      // Uma única cópia de React e do TanStack Query no grafo. Duas cópias de
      // React quebram com "Invalid hook call"; duas de query-core fazem o
      // QueryClient do router não ser o que os hooks leem — falha silenciosa.
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },

    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },

    server: {
      host: "::",
      port: 8080,
      // Uso interno atrás de domínios próprios e de túneis/proxies.
      allowedHosts: true,
    },
    preview: { allowedHosts: true },

    plugins: [
      tailwindcss(),
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      // tanstackStart PRECISA vir antes de viteReact.
      tanstackStart({
        // Entrada SSR customizada: src/server.ts embrulha os erros que o h3
        // engoliria e devolve uma página de erro em HTML. O nitro builda daqui.
        server: { entry: "server" },
        importProtection: {
          behavior: "error",
          client: { files: ["**/*.server.ts"], specifiers: ["server-only"] },
        },
      }),
      // Em dev o SSR é servido pelo próprio Vite; nitro só no build.
      // NITRO_PRESET sobrescreve o defaultPreset quando necessário.
      ...(command === "build" ? [nitro({ defaultPreset: "node-server" })] : []),
      viteReact(),
    ],
  };
});
