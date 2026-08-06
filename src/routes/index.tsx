import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Info,
  Loader2,
  ShieldCheck,
  Sparkles,
  FileCheck2,
} from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { SiteHeader } from "@/components/SiteHeader";
import { UploadCard, type ArquivoUpload } from "@/components/UploadCard";
import { Button } from "@/components/ui/button";
import { analisarModelo, extrairDados } from "@/lib/contratos.functions";
import {
  detectarFormatoDocumento,
  MENSAGEM_CONVERSAO_DOC,
  MENSAGEM_FORMATO_INVALIDO,
} from "@/lib/formato-documento";
import {
  diagnosticarModelo,
  type Diagnostico,
  type ResultadoDiagnostico,
} from "@/lib/diagnostico-modelo";

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
  const [diagnostico, setDiagnostico] = useState<ResultadoDiagnostico | null>(null);
  // Modelo já validado. `templateBase64` é o .docx efetivo — se a origem era
  // .doc, é a versão convertida pelo servidor. Guardar aqui evita reanalisar na
  // hora de extrair e garante que a geração use exatamente o que foi analisado.
  const [modeloValidado, setModeloValidado] = useState<{
    placeholders: string[];
    templateBase64: string;
  } | null>(null);

  // Validação estrutural assim que o modelo é enviado: o usuário descobre o
  // problema na hora, não depois de esperar a extração com IA.
  const validacao = useMutation({
    mutationFn: async (arquivo: ArquivoUpload) => {
      const formato = detectarFormatoDocumento(arquivo.base64);
      // .doc segue para o servidor: lá ele é convertido, se o ambiente
      // permitir. Só formatos que não são Word nenhum são barrados aqui.
      if (formato !== "docx" && formato !== "doc") throw new Error(MENSAGEM_FORMATO_INVALIDO);

      const estrutura = await analisarModelo({ data: { templateBase64: arquivo.base64 } });
      return {
        estrutura,
        // Sem conversão, o servidor devolve string vazia e reusamos o original.
        templateBase64: estrutura.templateBase64 || arquivo.base64,
        resultado: diagnosticarModelo(estrutura),
      };
    },
    onSuccess: ({ estrutura, templateBase64, resultado }) => {
      setDiagnostico(resultado);
      if (resultado.erros.length > 0) {
        // Descarta o arquivo: só um modelo corrigido pode seguir adiante.
        setModelo([]);
        setModeloValidado(null);
        toast.error(
          `Modelo recusado — ${resultado.erros.length} problema(s) a corrigir no Word. Veja os detalhes abaixo.`,
        );
        return;
      }
      setModeloValidado({ placeholders: estrutura.placeholders, templateBase64 });
      toast.success(
        estrutura.convertidoDeDoc
          ? `Modelo convertido de .doc e validado — ${estrutura.placeholders.length} campos detectados.`
          : `Modelo validado — ${estrutura.placeholders.length} campos detectados.`,
      );
    },
    onError: (e) => {
      setModelo([]);
      setModeloValidado(null);
      setDiagnostico({
        erros: [
          {
            codigo: "modelo-invalido",
            titulo: "Não foi possível ler o modelo",
            detalhe: (e as Error).message,
          },
        ],
        avisos: [],
      });
      toast.error("Modelo recusado. Veja os detalhes abaixo.");
    },
  });

  function aoTrocarModelo(arquivos: ArquivoUpload[]) {
    setModelo(arquivos);
    setDiagnostico(null);
    setModeloValidado(null);
    validacao.reset();
    if (arquivos[0]) validacao.mutate(arquivos[0]);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!modelo[0] || !modeloValidado) {
        throw new Error("Envie um modelo de contrato Word válido.");
      }
      if (docs.length === 0) throw new Error("Envie ao menos um documento de origem.");

      const { placeholders } = modeloValidado;
      toast.message(`${placeholders.length} campos no modelo. Extraindo dados com a IA…`);
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
          template: {
            // Nome com extensão .docx: se veio de um .doc, o que segue adiante
            // é a versão convertida.
            nome: modelo[0].nome.replace(/\.docx?$/i, ".docx"),
            base64: modeloValidado!.templateBase64,
          },
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

  const pronto =
    modeloValidado !== null && docs.length > 0 && !mutation.isPending && !validacao.isPending;

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
                Documento Word (<strong>.docx</strong> ou <strong>.doc</strong>) com os campos
                marcados como{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[12px]">{"{{CAMPO}}"}</code>{" "}
                ou em <span className="font-semibold text-[color:var(--missing)]">vermelho</span>.
                <br />
                Modelos <strong>.doc</strong> são convertidos automaticamente.
              </>
            }
            accept=".docx,.doc"
            multiple={false}
            arquivos={modelo}
            onChange={aoTrocarModelo}
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

        {validacao.isPending && (
          <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Validando a estrutura do modelo…
          </p>
        )}

        {/* Erros do modelo — largura total, logo abaixo dos uploads */}
        {diagnostico && diagnostico.erros.length > 0 && (
          <section className="mt-5 rounded-xl border border-destructive bg-destructive/5 p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Modelo recusado — corrija no Word e envie novamente
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              O arquivo foi descartado para evitar que um contrato saia errado.
            </p>
            <ul className="mt-4 space-y-4">
              {diagnostico.erros.map((d) => (
                <ItemDiagnostico key={d.codigo} diagnostico={d} tom="erro" />
              ))}
            </ul>
          </section>
        )}

        {/* Avisos — não bloqueiam, ficam abaixo e à esquerda */}
        {diagnostico && diagnostico.avisos.length > 0 && (
          <section className="mt-5 mr-auto max-w-2xl rounded-xl border border-warning bg-warning/10 p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-warning-foreground">
              <Info className="h-4 w-4" />
              Avisos ({diagnostico.avisos.length}) — não impedem a geração
            </h3>
            <ul className="mt-4 space-y-4">
              {diagnostico.avisos.map((d) => (
                <ItemDiagnostico key={d.codigo} diagnostico={d} tom="aviso" />
              ))}
            </ul>
          </section>
        )}

        {mutation.isError && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-destructive bg-destructive/5 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <p className="text-sm text-foreground">{(mutation.error as Error).message}</p>
          </div>
        )}

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

function ItemDiagnostico({
  diagnostico,
  tom,
}: {
  diagnostico: Diagnostico;
  tom: "erro" | "aviso";
}) {
  return (
    <li>
      <div
        className={`text-sm font-medium ${tom === "erro" ? "text-destructive" : "text-warning-foreground"}`}
      >
        {diagnostico.titulo}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{diagnostico.detalhe}</p>
      {diagnostico.itens && diagnostico.itens.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {diagnostico.itens.map((item) => (
            <li
              key={item}
              className="rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground"
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
