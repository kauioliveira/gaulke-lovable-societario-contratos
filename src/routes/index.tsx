import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Loader2, ShieldCheck, Sparkles, FileCheck2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { SiteHeader } from "@/components/SiteHeader";
import { UploadCard, type ArquivoUpload } from "@/components/UploadCard";
import { Button } from "@/components/ui/button";
import { analisarModelo, extrairDados } from "@/lib/contratos.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Gerador de Contratos Societários · Gaulke Contábil" },
      {
        name: "description",
        content:
          "Automatize o preenchimento de contratos societários. Faça o upload do modelo e dos documentos da empresa e dos sócios para gerar um contrato pronto, sem retrabalho.",
      },
      { property: "og:title", content: "Gerador de Contratos Societários · Gaulke Contábil" },
      {
        property: "og:description",
        content:
          "Preencha contratos societários automaticamente a partir de viabilidade, DBE, RG, CNH e demais documentos.",
      },
    ],
  }),
  component: PaginaInicial,
});

function PaginaInicial() {
  const navigate = useNavigate();
  const [modelo, setModelo] = useState<ArquivoUpload[]>([]);
  const [docs, setDocs] = useState<ArquivoUpload[]>([]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!modelo[0]) throw new Error("Envie o modelo de contrato em .docx.");
      if (docs.length === 0) throw new Error("Envie ao menos um documento de origem.");

      toast.message("Lendo o modelo de contrato…");
      const { placeholders } = await analisarModelo({
        data: { templateBase64: modelo[0].base64 },
      });

      if (placeholders.length === 0) {
        throw new Error(
          "Nenhum campo variável foi encontrado no modelo. Use marcadores {{NOME_DO_CAMPO}} ou texto em vermelho.",
        );
      }

      toast.message(`Encontrados ${placeholders.length} campos. Extraindo dados com a IA…`);
      const extracao = await extrairDados({
        data: {
          placeholders,
          arquivos: docs.map((d) => ({ nome: d.nome, mime: d.mime, base64: d.base64 })),
        },
      });

      return { placeholders, extracao };
    },
    onSuccess: ({ placeholders, extracao }) => {
      sessionStorage.setItem(
        "gaulke:contrato:estado",
        JSON.stringify({
          template: { nome: modelo[0].nome, base64: modelo[0].base64 },
          placeholders,
          extracao,
        }),
      );
      toast.success("Dados extraídos. Revise antes de gerar o contrato.");
      void navigate({ to: "/revisao" });
    },
    onError: (e) => {
      toast.error((e as Error).message);
    },
  });

  const pronto = modelo.length === 1 && docs.length > 0 && !mutation.isPending;

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <section className="mb-8">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1 text-xs font-medium text-accent-foreground">
            <Sparkles className="h-3.5 w-3.5" /> Setor Societário
          </span>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Gerador de contratos societários
          </h1>
          <p className="mt-2 max-w-3xl text-base text-muted-foreground">
            Envie o modelo de contrato em Word e os documentos da empresa e dos sócios.
            Nossa inteligência identifica os dados, mantém a formatação jurídica intacta
            e preenche apenas os campos marcados — eliminando digitação manual e erros.
          </p>
        </section>

        <section className="grid gap-5 md:grid-cols-2">
          <UploadCard
            titulo="1. Modelo de contrato"
            descricao={
              <>
                Documento Word (<strong>.docx</strong>) com os campos marcados como{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[12px]">{"{{CAMPO}}"}</code>{" "}
                ou em <span className="font-semibold text-[color:var(--missing)]">vermelho</span>.
              </>
            }
            accept=".docx"
            multiple={false}
            arquivos={modelo}
            onChange={setModelo}
            maxArquivos={1}
          />
          <UploadCard
            titulo="2. Documentos da empresa e dos sócios"
            descricao={
              <>
                Viabilidade, DBE, ficha cadastral, RG, CNH, comprovante de residência,
                contratos anteriores. PDFs ou imagens.
              </>
            }
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            multiple
            arquivos={docs}
            onChange={setDocs}
            maxArquivos={10}
          />
        </section>

        <div className="mt-8 flex flex-col items-start justify-between gap-4 rounded-xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-info" />
            <p className="text-sm text-muted-foreground">
              Os arquivos são processados em memória para a extração e descartados ao final.
              Nenhum dado fica armazenado. Os textos jurídicos, cabeçalhos, rodapés e a
              formatação do modelo são preservados — somente os campos variáveis são preenchidos.
            </p>
          </div>
          <Button
            size="lg"
            disabled={!pronto}
            onClick={() => mutation.mutate()}
            className="bg-accent text-accent-foreground hover:bg-accent/90"
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analisando…
              </>
            ) : (
              <>
                <FileCheck2 className="mr-2 h-4 w-4" />
                Analisar documentos
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </div>

        <section className="mt-10 grid gap-4 sm:grid-cols-3">
          {[
            {
              t: "Formatação intacta",
              d: "Cláusulas, margens, fontes, tabelas e numeração permanecem idênticas ao modelo.",
            },
            {
              t: "Sem invenção de dados",
              d: "Se algo não estiver claro nos documentos, o campo fica em vermelho para revisão.",
            },
            {
              t: "Validações automáticas",
              d: "CPF, CNPJ, CEP, capital social e nomes são conferidos antes de gerar o arquivo.",
            },
          ].map((c) => (
            <div key={c.t} className="rounded-xl border border-border bg-card p-5">
              <h4 className="text-sm font-semibold text-foreground">{c.t}</h4>
              <p className="mt-1 text-sm text-muted-foreground">{c.d}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
