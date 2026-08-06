import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Eye,
  FileWarning,
  HelpCircle,
  Loader2,
} from "lucide-react";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { gerarContrato } from "@/lib/contratos.functions";
import { agruparGrafiasEquivalentes } from "@/lib/diagnostico-modelo";
import {
  chavePeca,
  ehChaveDeEndereco,
  lerComponentes,
  PECAS_ENDERECO,
  ROTULO_PECA,
  type EscopoEndereco,
  type PecaEndereco,
} from "@/lib/endereco-campos";
import { montarEnderecoEmpresa, montarEnderecoSocio } from "@/lib/formatters";
import {
  aplicarFormatacao,
  cnpjValido,
  cpfValido,
  detectarTipo,
  moedaPorExtenso,
  quotasPorExtenso,
} from "@/lib/formatters";

export const Route = createFileRoute("/revisao")({
  head: () => ({
    meta: [
      { title: "Revisão dos dados · Gaulke Contábil" },
      {
        name: "description",
        content:
          "Revise os dados extraídos dos documentos e gere o contrato societário preenchido.",
      },
    ],
  }),
  component: PaginaRevisao,
});

type Estado = {
  template: { nome: string; base64: string };
  placeholders: string[];
  extracao: {
    valores: Record<
      string,
      { valor: string; fonte: string; confianca: "alta" | "media" | "baixa" }
    >;
    faltantes: string[];
    conflitos: { campo: string; valores: { valor: string; fonte: string }[] }[];
    observacoes: string;
    tokens?: number;
  };
};

const REGIMES_BENS = [
  "Comunhão parcial de bens",
  "Comunhão universal de bens",
  "Separação total de bens",
  "Participação final nos aquestos",
];

const ESTADOS_CIVIS = [
  "Solteiro(a)",
  "Casado(a)",
  "Divorciado(a)",
  "Viúvo(a)",
  "Separado(a) judicialmente",
  "União estável",
];

/**
 * O CSS não consegue selecionar um parágrafo pelo conteúdo, então marcamos aqui
 * as linhas de assinatura (aquelas feitas só de sublinhados) para que recebam
 * folga antes e não fiquem coladas no texto da última cláusula.
 */
function marcarLinhasDeAssinatura(html: string): string {
  return html.replace(/<p>(\s*_{4,}\s*)<\/p>/g, '<p class="assinatura">$1</p>');
}

type Problema = {
  campo: string;
  mensagem: string;
  tipo: "erro" | "aviso";
  /** Texto do "?" ao lado: onde achar o dado, qual o formato, por que trava. */
  ajuda?: string;
};

function nomeAmigavel(placeholder: string) {
  return placeholder
    .replace(/^__VERMELHO__::/, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function PaginaRevisao() {
  const navigate = useNavigate();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [regimeBens, setRegimeBens] = useState<string>("");
  const [tipoDocIdentidade, setTipoDocIdentidade] = useState<"RG" | "CNH">("RG");
  // Campos que o usuário já revisou (saiu do input). Some o selo "conferir"
  // desses — o aviso serve para dirigir a atenção, não para poluir o que já foi
  // olhado. Se o campo for esvaziado, o selo volta.
  const [conferidos, setConferidos] = useState<Set<string>>(new Set());
  const marcarConferido = useCallback(
    (chave: string) => setConferidos((s) => (s.has(chave) ? s : new Set(s).add(chave))),
    [],
  );
  const [preview, setPreview] = useState<{ html: string; base64: string } | null>(null);
  const [convertendoPreview, setConvertendoPreview] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem("gaulke:contrato:estado");
    if (!raw) {
      void navigate({ to: "/" });
      return;
    }
    const e = JSON.parse(raw) as Estado;
    setEstado(e);
    const iniciais: Record<string, string> = {};
    const hojeISO = (() => {
      const br = new Date().toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      const [d, m, a] = br.split("/");
      return `${a}-${m}-${d}`;
    })();
    const ehDataAtual = (nome: string) => {
      const n = nome
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[_\s]+/g, " ")
        .trim();
      return (
        /\bdata\b.*\b(atual|hoje|do dia|corrente|emiss[aã]o|gera[cç][aã]o)\b/.test(n) ||
        /\b(data atual|data de hoje|data do dia|data corrente)\b/.test(n)
      );
    };
    for (const ph of e.placeholders) {
      const chaveLimpa = ph.replace(/^__VERMELHO__::/, "");
      const valBruto = ehDataAtual(chaveLimpa)
        ? hojeISO
        : (e.extracao.valores[chaveLimpa]?.valor ?? "");
      iniciais[ph] = aplicarFormatacao(
        valBruto,
        ehDataAtual(chaveLimpa) ? "data" : detectarTipo(chaveLimpa),
      );
    }
    // Componentes de endereço: não são placeholders do Word, vêm como campos
    // sintéticos da extração e ganham um input próprio na tela.
    for (const [chave, v] of Object.entries(e.extracao.valores)) {
      if (!ehChaveDeEndereco(chave)) continue;
      const peca = chave.replace(/^__END(SOCIO|EMPRESA)_/, "").replace(/__$/, "") as PecaEndereco;
      iniciais[chave] = aplicarFormatacao(v.valor ?? "", ROTULO_PECA[peca]?.tipo ?? "texto");
    }
    setValores(iniciais);
    const metaTipo = e.extracao.valores["__META_TIPO_DOC_IDENTIDADE__"]?.valor;
    if (metaTipo === "CNH" || metaTipo === "RG") setTipoDocIdentidade(metaTipo);
  }, [navigate]);

  // Um card por CAMPO, não por marcador: grafias equivalentes (SOCIO/SÓCIO)
  // compartilham um único input e `equivalentes` guarda todas as chaves que
  // devem receber o valor digitado.
  const placeholdersExibidos = useMemo(() => {
    if (!estado) return [];
    return agruparGrafiasEquivalentes(estado.placeholders).map((grupo) => {
      const ph = grupo[0];
      const original = ph.replace(/^__VERMELHO__::/, "");
      return {
        chave: ph,
        equivalentes: grupo,
        nome: original,
        rotulo: nomeAmigavel(ph),
        tipo: detectarTipo(original),
        ehVermelho: ph.startsWith("__VERMELHO__::"),
        fonte: estado.extracao.valores[original]?.fonte ?? "—",
        confianca: estado.extracao.valores[original]?.confianca ?? "baixa",
        grafiasExtras: grupo.slice(1).map((k) => nomeAmigavel(k)),
      };
    });
  }, [estado]);

  // Endereços compostos viram um grupo de campos (rua, nº, bairro, cidade, UF,
  // CEP) em vez de um input só, para dar para conferir peça por peça. A linha
  // final é remontada na geração e gravada no marcador composto.
  const gruposEndereco = useMemo(() => {
    const grupos: { escopo: EscopoEndereco; titulo: string; chaveDestino: string }[] = [];
    for (const p of placeholdersExibidos) {
      if (p.tipo === "enderecoSocio" && !grupos.some((g) => g.escopo === "socio")) {
        grupos.push({ escopo: "socio", titulo: "Endereço do sócio", chaveDestino: p.chave });
      }
      if (p.tipo === "enderecoEmpresa" && !grupos.some((g) => g.escopo === "empresa")) {
        grupos.push({
          escopo: "empresa",
          titulo: "Endereço da empresa (sede)",
          chaveDestino: p.chave,
        });
      }
    }
    return grupos;
  }, [placeholdersExibidos]);

  const chavesDeEnderecoComposto = useMemo(
    () => new Set(gruposEndereco.map((g) => g.chaveDestino)),
    [gruposEndereco],
  );

  // Linha montada a partir das peças — é exatamente o que vai para o contrato.
  const montarLinhaEndereco = useCallback(
    (escopo: EscopoEndereco) => {
      const c = lerComponentes(valores, escopo);
      return escopo === "socio" ? montarEnderecoSocio(c) : montarEnderecoEmpresa(c);
    },
    [valores],
  );

  const estadoCivilChave = useMemo(
    () => placeholdersExibidos.find((p) => /estado.?civil/i.test(p.nome))?.chave,
    [placeholdersExibidos],
  );

  const isCasado = estadoCivilChave ? /casad/i.test(valores[estadoCivilChave] ?? "") : false;

  // Sem isso o regime escolhido fica preso no state depois que o usuário troca
  // o estado civil para solteiro, e acabaria no contrato.
  useEffect(() => {
    if (!isCasado && regimeBens) setRegimeBens("");
  }, [isCasado, regimeBens]);

  // Sincroniza campos "por extenso" com seus equivalentes numéricos
  const capitalChave = useMemo(
    () =>
      placeholdersExibidos.find((p) => /capital.*social/i.test(p.nome) && !/extenso/i.test(p.nome))
        ?.chave,
    [placeholdersExibidos],
  );
  const capitalExtensoChave = useMemo(
    () => placeholdersExibidos.find((p) => /capital.*social.*extenso/i.test(p.nome))?.chave,
    [placeholdersExibidos],
  );
  const quotasChave = useMemo(
    () =>
      placeholdersExibidos.find(
        (p) =>
          /^quotas?$|n[uú]mero.*quotas?|quantidade.*quotas?/i.test(p.nome) &&
          !/extenso/i.test(p.nome),
      )?.chave,
    [placeholdersExibidos],
  );
  const quotasExtensoChave = useMemo(
    () => placeholdersExibidos.find((p) => /quotas?.*extenso/i.test(p.nome))?.chave,
    [placeholdersExibidos],
  );

  useEffect(() => {
    if (!capitalChave || !capitalExtensoChave) return;
    const num = valores[capitalChave];
    if (!num) return;
    const extenso = moedaPorExtenso(num);
    if (!extenso) return;
    setValores((s) =>
      s[capitalExtensoChave] === extenso ? s : { ...s, [capitalExtensoChave]: extenso },
    );
  }, [capitalChave, capitalExtensoChave, valores]);

  useEffect(() => {
    if (!quotasChave || !quotasExtensoChave) return;
    const num = valores[quotasChave];
    if (!num) return;
    const extenso = quotasPorExtenso(num);
    if (!extenso) return;
    setValores((s) =>
      s[quotasExtensoChave] === extenso ? s : { ...s, [quotasExtensoChave]: extenso },
    );
  }, [quotasChave, quotasExtensoChave, valores]);

  const problemas = useMemo(() => {
    const lista: Problema[] = [];
    for (const p of placeholdersExibidos) {
      // O campo composto é preenchido pelas peças na geração; validá-lo aqui
      // acusaria "em branco" mesmo com todas as peças preenchidas.
      if (chavesDeEnderecoComposto.has(p.chave)) continue;
      const v = valores[p.chave] ?? "";
      if (!v.trim()) {
        lista.push({
          campo: p.rotulo,
          mensagem: "Campo em branco",
          tipo: "erro",
          ajuda:
            "Todo marcador do modelo precisa de um valor, senão o {{CAMPO}} sai literal no contrato. Se o dado não existir mesmo, escreva um traço.",
        });
        continue;
      }
      if (p.tipo === "cpf" && !cpfValido(v))
        lista.push({
          campo: p.rotulo,
          mensagem: "CPF inválido",
          tipo: "erro",
          ajuda:
            "Os dígitos verificadores não fecham. Confira contra a CNH, o RG ou o comprovante — provavelmente um dígito foi lido errado.",
        });
      if (p.tipo === "cnpj" && !cnpjValido(v))
        lista.push({
          campo: p.rotulo,
          mensagem: "CNPJ inválido",
          tipo: "erro",
          ajuda: "Os dígitos verificadores não fecham. Confira no REGIN ou no DBE.",
        });
      if (p.tipo === "cep" && !/^\d{5}-\d{3}$/.test(v))
        lista.push({
          campo: p.rotulo,
          mensagem: "CEP fora do padrão 00000-000",
          tipo: "aviso",
          ajuda:
            "Escreva os 8 dígitos; a pontuação é aplicada automaticamente. O CEP aparece no comprovante de residência e na fatura de energia.",
        });
      if (p.tipo === "uf" && v.trim() && !/^[A-Z]{2}$/.test(v.trim()))
        lista.push({
          campo: p.rotulo,
          mensagem: "UF deve ter 2 letras",
          tipo: "aviso",
          ajuda: "Use a sigla do estado, por exemplo SC, PR ou SP.",
        });
    }

    // Peças de endereço obrigatórias
    for (const g of gruposEndereco) {
      for (const peca of [
        "LOGRADOURO",
        "NUMERO",
        "BAIRRO",
        "CIDADE",
        "UF",
        "CEP",
      ] as PecaEndereco[]) {
        const chave = chavePeca(g.escopo, peca);
        if ((valores[chave] ?? "").trim()) continue;
        lista.push({
          campo: `${g.titulo} · ${ROTULO_PECA[peca].rotulo}`,
          mensagem: "Não preenchido",
          tipo: "erro",
          ajuda:
            g.escopo === "socio"
              ? "O endereço do sócio sai do comprovante de residência ou da CNH."
              : "O endereço da sede sai do REGIN, do DBE ou da ficha cadastral — costuma ser diferente do endereço do sócio.",
        });
      }
    }

    if (isCasado && !regimeBens) {
      lista.push({
        campo: "Regime de bens",
        mensagem: "Selecione o regime de bens",
        tipo: "erro",
        ajuda:
          "Para sócio casado o contrato precisa declarar o regime. Ele consta da certidão de casamento; na dúvida, comunhão parcial é o regime legal desde 1977.",
      });
    }

    // A cláusula do capital costuma dizer "quotas no valor de R$ 1,00". Quando é
    // esse o caso, capital e quotas têm que bater — senão o contrato sai com
    // uma conta errada e ninguém percebe.
    if (capitalChave && quotasChave) {
      const capital = Number(
        (valores[capitalChave] ?? "")
          .replace(/[^\d,.-]/g, "")
          .replace(/\./g, "")
          .replace(",", "."),
      );
      const quotas = Number((valores[quotasChave] ?? "").replace(/\D/g, ""));
      if (Number.isFinite(capital) && capital > 0 && quotas > 0 && Math.round(capital) !== quotas) {
        lista.push({
          campo: "Capital social × quotas",
          mensagem: `${quotas.toLocaleString("pt-BR")} quotas para um capital de R$ ${capital.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
          tipo: "aviso",
          ajuda:
            "Se cada quota vale R$ 1,00 (como diz a cláusula do capital neste modelo), o número de quotas tem que ser igual ao capital. Confira se a quota deste contrato tem outro valor unitário.",
        });
      }
    }
    return lista;
  }, [
    placeholdersExibidos,
    valores,
    isCasado,
    regimeBens,
    gruposEndereco,
    chavesDeEnderecoComposto,
    capitalChave,
    quotasChave,
  ]);

  const conflitos = estado?.extracao.conflitos ?? [];
  const observacoes = estado?.extracao.observacoes ?? "";

  // Faltantes reativos: o que a IA não achou MENOS o que já foi preenchido à
  // mão. Antes a lista era estática e continuava acusando campos resolvidos.
  const faltantes = useMemo(() => {
    const reportados = estado?.extracao.faltantes ?? [];
    return reportados.filter((nome) => {
      const grupo = placeholdersExibidos.find(
        (p) =>
          p.nome === nome || p.equivalentes.some((k) => k.replace(/^__VERMELHO__::/, "") === nome),
      );
      // Campo que não existe mais na tela (ex.: virou peça de endereço) some.
      if (!grupo) return false;
      return !(valores[grupo.chave] ?? "").trim();
    });
  }, [estado, placeholdersExibidos, valores]);

  const podeGerar = problemas.filter((p) => p.tipo === "erro").length === 0 && estado !== null;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!estado) throw new Error("Estado não inicializado.");
      // Aplica formatação final antes do envio
      const valoresFinais: Record<string, string> = {};
      for (const p of placeholdersExibidos) {
        const bruto = valores[p.chave] ?? "";
        const valor = aplicarFormatacao(bruto, p.tipo);
        // Replica em todas as grafias equivalentes do mesmo campo, para que
        // {{SOCIO}} e {{SÓCIO}} recebam o mesmo texto no contrato.
        for (const chave of p.equivalentes) valoresFinais[chave] = valor;
      }

      // Endereços: a linha vai montada a partir das peças conferidas na tela.
      for (const g of gruposEndereco) {
        const linha = montarLinhaEndereco(g.escopo);
        const grupo = placeholdersExibidos.find((p) => p.chave === g.chaveDestino);
        for (const chave of grupo?.equivalentes ?? [g.chaveDestino]) {
          valoresFinais[chave] = linha;
        }
      }

      // Regime de bens: no marcador próprio, se o modelo tiver um. Como a
      // maioria dos modelos não tem, o padrão é escrever no estado civil —
      // "casado sob o regime de comunhão parcial de bens" —, que é como o
      // contrato social redige. Sem isso a escolha do usuário era descartada.
      const regimeKey = placeholdersExibidos.find((p) =>
        /regime.*(bens|matrimonial|casamento)/i.test(p.nome),
      )?.chave;
      if (regimeBens) {
        if (regimeKey) {
          valoresFinais[regimeKey] = regimeBens;
        } else if (estadoCivilChave) {
          const grupoCivil = placeholdersExibidos.find((p) => p.chave === estadoCivilChave);
          const civil = (valoresFinais[estadoCivilChave] ?? "").replace(/\(a\)/gi, "").trim();
          const texto = `${civil.toLocaleLowerCase("pt-BR")} sob o regime de ${regimeBens.toLocaleLowerCase("pt-BR")}`;
          for (const chave of grupoCivil?.equivalentes ?? [estadoCivilChave]) {
            valoresFinais[chave] = texto;
          }
        }
      }

      // Propagar meta-campos (ex.: __META_TIPO_DOC_IDENTIDADE__) para a geração
      for (const [k, v] of Object.entries(estado.extracao.valores)) {
        if (k.startsWith("__META_")) valoresFinais[k] = v.valor;
      }
      // Sobrescreve com a escolha manual do usuário
      valoresFinais["__META_TIPO_DOC_IDENTIDADE__"] = tipoDocIdentidade;

      // Capital social: se existe placeholder próprio de "por extenso", preenche
      // separadamente e remove "R$ " do numérico (o modelo normalmente já tem "R$"
      // fixo antes do placeholder). Caso contrário, concatena valor + extenso.
      if (capitalChave) {
        const numStr = valoresFinais[capitalChave] ?? "";
        const extenso = moedaPorExtenso(valores[capitalChave] ?? "");
        if (capitalExtensoChave) {
          valoresFinais[capitalChave] = numStr.replace(/^\s*R\$\s*/i, "");
          if (extenso) valoresFinais[capitalExtensoChave] = extenso;
        } else if (numStr && extenso) {
          valoresFinais[capitalChave] = `${numStr} (${extenso})`;
        }
      }
      // Quotas: mesma lógica — se há placeholder de extenso, preenche separado.
      if (quotasChave) {
        const numStr = valoresFinais[quotasChave] ?? "";
        const extenso = quotasPorExtenso(valores[quotasChave] ?? "");
        if (quotasExtensoChave) {
          if (extenso) valoresFinais[quotasExtensoChave] = extenso;
        } else if (numStr && extenso) {
          valoresFinais[quotasChave] = `${numStr} (${extenso})`;
        }
      }

      const { docxBase64 } = await gerarContrato({
        data: {
          templateBase64: estado.template.base64,
          valores: valoresFinais,
        },
      });
      return docxBase64;
    },
    onSuccess: async (base64) => {
      try {
        setConvertendoPreview(true);
        const mammoth = await import("mammoth");
        const bin = atob(base64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const { value } = await mammoth.convertToHtml({ arrayBuffer: arr.buffer });
        setPreview({ html: marcarLinhasDeAssinatura(value), base64 });
      } catch (err) {
        toast.error("Falha ao gerar pré-visualização: " + (err as Error).message);
      } finally {
        setConvertendoPreview(false);
      }
    },
    onError: (e) => toast.error((e as Error).message),
  });

  function baixarDocx() {
    if (!preview || !estado) return;
    const nomeBase = estado.template.nome.replace(/\.docx$/i, "");
    const data = new Date().toISOString().slice(0, 10);
    const blob = base64ParaBlob(preview.base64);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${nomeBase}_preenchido_${data}.docx`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Contrato baixado!");
    setPreview(null);
  }

  if (!estado) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <main className="mx-auto flex max-w-6xl items-center justify-center px-4 py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <button
              onClick={() => void navigate({ to: "/" })}
              className="inline-flex items-center text-sm text-info hover:underline"
            >
              <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
            </button>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Revisão dos dados extraídos
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Modelo: <span className="font-medium text-foreground">{estado.template.nome}</span> ·{" "}
              {estado.placeholders.length} campos detectados
              {estado.extracao.tokens ? (
                <> · {estado.extracao.tokens.toLocaleString("pt-BR")} tokens consumidos</>
              ) : null}
            </p>
          </div>
          <BotaoPrevisualizar
            desabilitado={!podeGerar || mutation.isPending || convertendoPreview}
            ocupado={mutation.isPending || convertendoPreview}
            rotuloOcupado={convertendoPreview ? "Preparando prévia…" : "Gerando…"}
            onClick={() => mutation.mutate()}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
          {/* Campos */}
          <div className="min-w-0 space-y-5">
            {gruposEndereco.map((g) => (
              <CardEndereco
                key={g.escopo}
                titulo={g.titulo}
                escopo={g.escopo}
                valores={valores}
                setValores={setValores}
                linhaMontada={montarLinhaEndereco(g.escopo)}
              />
            ))}

            <div className="rounded-xl border border-border bg-card p-4">
              <Label className="mb-2 block text-sm font-semibold text-foreground">
                Documento de identidade do sócio
              </Label>
              <p className="mb-3 text-xs text-muted-foreground">
                Escolha qual documento será citado no preâmbulo do contrato.
              </p>
              <RadioGroup
                value={tipoDocIdentidade}
                onValueChange={(v) => setTipoDocIdentidade(v as "RG" | "CNH")}
                className="flex flex-col gap-2 sm:flex-row sm:gap-6"
              >
                <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <RadioGroupItem value="RG" id="doc-rg" />
                  Carteira de Identidade (RG)
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <RadioGroupItem value="CNH" id="doc-cnh" />
                  Carteira Nacional de Habilitação (CNH)
                </label>
              </RadioGroup>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Campos do contrato
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {placeholdersExibidos.map((p) => {
                  // Endereço composto tem card próprio, com as peças separadas.
                  if (chavesDeEnderecoComposto.has(p.chave)) return null;
                  const v = valores[p.chave] ?? "";
                  const vazio = !v.trim();
                  const ehLongo = p.tipo === "objeto" || /extenso/i.test(p.nome);
                  const ehEstadoCivil = /estado.?civil/i.test(p.nome);
                  // A IA já diz o quanto confia em cada leitura; destacar os
                  // incertos direciona a conferência para onde importa.
                  const incerto = p.confianca === "baixa" && (vazio || !conferidos.has(p.chave));
                  return (
                    <div key={p.chave} className={ehLongo ? "sm:col-span-2" : ""}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <Label className="text-xs font-medium text-foreground">
                          {p.rotulo}
                          {p.ehVermelho && (
                            <Badge className="ml-2 bg-[color:var(--missing)] text-white">
                              vermelho
                            </Badge>
                          )}
                          {p.grafiasExtras.length > 0 && (
                            <Badge
                              variant="outline"
                              className="ml-2 font-normal"
                              title={`Preenche também: ${p.grafiasExtras.join(", ")}`}
                            >
                              +{p.grafiasExtras.length} marcador
                              {p.grafiasExtras.length > 1 ? "es" : ""}
                            </Badge>
                          )}
                          {incerto && (
                            <Badge
                              variant="outline"
                              className="ml-2 border-warning font-normal text-warning-foreground"
                              title="A IA teve baixa confiança nesta leitura — confira contra o documento."
                            >
                              conferir
                            </Badge>
                          )}
                        </Label>
                        <span className="text-[10px] text-muted-foreground">
                          {p.fonte !== "—" ? `de: ${p.fonte}` : "sem fonte"}
                        </span>
                      </div>
                      {ehEstadoCivil ? (
                        <Select
                          value={v}
                          onValueChange={(novo) => {
                            setValores((s) => ({ ...s, [p.chave]: novo }));
                            marcarConferido(p.chave);
                          }}
                        >
                          <SelectTrigger
                            className={
                              vazio
                                ? "border-[color:var(--missing)] bg-[color:var(--missing)]/5"
                                : ""
                            }
                          >
                            <SelectValue placeholder="Selecione o estado civil…" />
                          </SelectTrigger>
                          <SelectContent>
                            {ESTADOS_CIVIS.map((ec) => (
                              <SelectItem key={ec} value={ec}>
                                {ec}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : ehLongo ? (
                        <Textarea
                          value={v}
                          onChange={(e) => setValores((s) => ({ ...s, [p.chave]: e.target.value }))}
                          onBlur={(e) => {
                            setValores((s) => ({
                              ...s,
                              [p.chave]: aplicarFormatacao(e.target.value, p.tipo),
                            }));
                            marcarConferido(p.chave);
                          }}
                          rows={3}
                          className={
                            vazio ? "border-[color:var(--missing)] bg-[color:var(--missing)]/5" : ""
                          }
                          placeholder="Preencher manualmente"
                        />
                      ) : (
                        <Input
                          value={v}
                          onChange={(e) => setValores((s) => ({ ...s, [p.chave]: e.target.value }))}
                          onBlur={(e) => {
                            setValores((s) => ({
                              ...s,
                              [p.chave]: aplicarFormatacao(e.target.value, p.tipo),
                            }));
                            marcarConferido(p.chave);
                          }}
                          className={
                            vazio
                              ? "border-[color:var(--missing)] bg-[color:var(--missing)]/5 text-[color:var(--missing)]"
                              : ""
                          }
                          placeholder="Preencher manualmente"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Regime de bens fica no fim: depende do estado civil, que está
                entre os campos acima — perguntar antes de o usuário chegar lá
                não fazia sentido. */}
            {isCasado && (
              <div className="rounded-xl border border-warning bg-warning/10 p-4">
                <Label className="mb-1 block text-sm font-semibold text-warning-foreground">
                  Regime de bens (obrigatório para sócio casado)
                </Label>
                <p className="mb-3 text-xs text-muted-foreground">
                  Será escrito no preâmbulo junto ao estado civil, no formato “casado sob o regime
                  de …”.
                </p>
                <Select value={regimeBens} onValueChange={setRegimeBens}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o regime…" />
                  </SelectTrigger>
                  <SelectContent>
                    {REGIMES_BENS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Mesmo botão do topo, repetido aqui para quem terminou de revisar
                e não quer rolar de volta. */}
            <div className="flex flex-col items-stretch gap-2 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                {podeGerar
                  ? "Tudo certo. Gere a prévia para conferir antes de baixar."
                  : `${problemas.filter((p) => p.tipo === "erro").length} pendência(s) a resolver antes de gerar.`}
              </p>
              <BotaoPrevisualizar
                desabilitado={!podeGerar || mutation.isPending || convertendoPreview}
                ocupado={mutation.isPending || convertendoPreview}
                rotuloOcupado={convertendoPreview ? "Preparando prévia…" : "Gerando…"}
                onClick={() => mutation.mutate()}
              />
            </div>
          </div>

          {/* Painel lateral */}
          <aside className="min-w-0 space-y-4">
            <div className="min-w-0 rounded-xl border border-border bg-card p-4">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </h4>
              <div className="space-y-2 text-sm">
                <Linha
                  ok={problemas.filter((p) => p.tipo === "erro").length === 0}
                  texto={
                    problemas.filter((p) => p.tipo === "erro").length === 0
                      ? "Todos os campos críticos preenchidos"
                      : `${problemas.filter((p) => p.tipo === "erro").length} bloqueio(s) a resolver`
                  }
                />
                <Linha
                  ok={faltantes.length === 0}
                  aviso
                  texto={
                    faltantes.length === 0
                      ? "Nenhum dado faltante reportado pela IA"
                      : `${faltantes.length} dado(s) não encontrado(s) nos documentos`
                  }
                />
                <Linha
                  ok={conflitos.length === 0}
                  aviso
                  texto={
                    conflitos.length === 0
                      ? "Sem conflitos entre documentos"
                      : `${conflitos.length} conflito(s) entre documentos`
                  }
                />
              </div>
            </div>

            {conflitos.length > 0 && (
              <div className="min-w-0 rounded-xl border border-warning bg-warning/10 p-4">
                <div className="mb-1 flex items-start gap-2 text-sm font-semibold text-warning-foreground">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0 break-words">Conflitos detectados</span>
                </div>
                <p className="mb-3 text-xs text-muted-foreground">
                  Documentos diferentes trazem valores diferentes. A IA não escolhe — decida você e
                  corrija o campo.
                </p>
                <ul className="max-h-72 space-y-3 overflow-y-auto pr-1">
                  {conflitos.map((c, i) => (
                    <li key={i} className="min-w-0 rounded-md border border-warning/60 bg-card p-2">
                      <div className="break-words text-xs font-semibold text-foreground">
                        {nomeAmigavel(c.campo)}
                      </div>
                      <div className="mt-1.5 space-y-1.5">
                        {c.valores.map((v, j) => (
                          <div key={j} className="min-w-0 border-l-2 border-warning pl-2">
                            <div className="break-words text-xs text-foreground">{v.valor}</div>
                            <div className="break-words text-[10px] text-muted-foreground">
                              {v.fonte}
                            </div>
                          </div>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {faltantes.length > 0 && (
              <div className="min-w-0 rounded-xl border border-[color:var(--missing)] bg-[color:var(--missing)]/5 p-4">
                <div className="mb-1 flex items-start gap-2 text-sm font-semibold text-[color:var(--missing)]">
                  <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0 break-words">Dados faltantes ({faltantes.length})</span>
                </div>
                <p className="mb-2 text-xs text-muted-foreground">
                  Não encontrados nos documentos. Somem daqui conforme você preenche.
                </p>
                <ul className="max-h-56 space-y-1 overflow-y-auto pr-1 text-xs text-foreground">
                  {faltantes.map((f, i) => (
                    <li key={i} className="min-w-0 break-words">
                      • {nomeAmigavel(f)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {problemas.length > 0 && (
              <div className="min-w-0 rounded-xl border border-border bg-card p-4">
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Validações ({problemas.length})
                </h4>
                <p className="mb-2 text-xs text-muted-foreground">
                  Em vermelho, o que impede gerar. Em âmbar, o que só merece um olhar.
                </p>
                <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {problemas.map((p, i) => (
                    <ItemValidacao key={i} problema={p} />
                  ))}
                </ul>
              </div>
            )}

            {observacoes && (
              <div className="min-w-0 rounded-xl border border-border bg-muted/40 p-4">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Observações da IA
                </h4>
                <p className="hyphens-auto whitespace-pre-wrap break-words text-justify text-xs leading-relaxed text-foreground">
                  {observacoes}
                </p>
              </div>
            )}
          </aside>
        </div>
      </main>

      <Dialog open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle>Pré-visualização do contrato</DialogTitle>
            <DialogDescription>
              Confira o conteúdo abaixo. A formatação final no Word pode ter pequenas diferenças
              visuais (esta prévia é uma aproximação em HTML).
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[calc(90vh-11rem)] overflow-y-auto bg-white px-10 py-8 text-sm text-black">
            <div
              className="contrato-preview"
              dangerouslySetInnerHTML={{ __html: preview?.html ?? "" }}
            />
          </div>
          <DialogFooter className="border-t border-border px-6 py-4">
            <Button variant="outline" onClick={() => setPreview(null)}>
              Voltar e editar
            </Button>
            <Button
              onClick={baixarDocx}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              <Download className="mr-2 h-4 w-4" /> Baixar .docx
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Aparece duas vezes: no topo e no fim da lista de campos, para quem terminou
// de revisar não precisar rolar de volta.
function BotaoPrevisualizar({
  desabilitado,
  ocupado,
  rotuloOcupado,
  onClick,
}: {
  desabilitado: boolean;
  ocupado: boolean;
  rotuloOcupado: string;
  onClick: () => void;
}) {
  return (
    <Button
      size="lg"
      disabled={desabilitado}
      onClick={onClick}
      className="shrink-0 bg-accent text-accent-foreground hover:bg-accent/90"
    >
      {ocupado ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {rotuloOcupado}
        </>
      ) : (
        <>
          <Eye className="mr-2 h-4 w-4" /> Pré-visualizar contrato
        </>
      )}
    </Button>
  );
}

// Um item de validação com "?" ao lado. A ajuda diz onde o dado costuma estar
// no documento e qual o formato — evita o revisor travar sem saber o que fazer.
function ItemValidacao({ problema }: { problema: Problema }) {
  const [aberto, setAberto] = useState(false);
  const cor = problema.tipo === "erro" ? "text-destructive" : "text-warning-foreground";
  return (
    <li className="min-w-0">
      <div className={`flex min-w-0 items-start gap-1.5 text-xs ${cor}`}>
        <span className="shrink-0">•</span>
        <span className="min-w-0 break-words">
          <span className="font-medium">{problema.campo}:</span> {problema.mensagem}
        </span>
        {problema.ajuda && (
          <button
            type="button"
            onClick={() => setAberto((a) => !a)}
            aria-expanded={aberto}
            aria-label={`Ajuda sobre ${problema.campo}`}
            className="ml-auto shrink-0 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {aberto && problema.ajuda && (
        <p className="mt-1 break-words rounded-md bg-muted/60 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {problema.ajuda}
        </p>
      )}
    </li>
  );
}

// Endereço peça a peça, com a linha final montada logo abaixo — o revisor vê
// exatamente o texto que vai para o contrato enquanto corrige os componentes.
function CardEndereco({
  titulo,
  escopo,
  valores,
  setValores,
  linhaMontada,
}: {
  titulo: string;
  escopo: EscopoEndereco;
  valores: Record<string, string>;
  setValores: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  linhaMontada: string;
}) {
  // Largura de cada peça no grid de 6 colunas.
  const colunas: Record<PecaEndereco, string> = {
    LOGRADOURO: "col-span-6 sm:col-span-4",
    NUMERO: "col-span-3 sm:col-span-2",
    COMPLEMENTO: "col-span-3 sm:col-span-2",
    BAIRRO: "col-span-6 sm:col-span-4",
    CIDADE: "col-span-6 sm:col-span-3",
    UF: "col-span-2 sm:col-span-1",
    CEP: "col-span-4 sm:col-span-2",
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="mb-1 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo}
      </h3>
      <p className="mb-4 text-xs text-muted-foreground">
        Confira peça por peça. O contrato recebe a linha montada mostrada abaixo.
      </p>
      <div className="grid grid-cols-6 gap-3">
        {PECAS_ENDERECO.map((peca) => {
          const chave = chavePeca(escopo, peca);
          const { rotulo, tipo } = ROTULO_PECA[peca];
          const v = valores[chave] ?? "";
          const opcional = peca === "COMPLEMENTO";
          const vazio = !v.trim() && !opcional;
          return (
            <div key={peca} className={colunas[peca]}>
              <Label className="mb-1 block text-xs font-medium text-foreground">
                {rotulo}
                {opcional && <span className="ml-1 text-muted-foreground">(opcional)</span>}
              </Label>
              <Input
                value={v}
                onChange={(e) => setValores((s) => ({ ...s, [chave]: e.target.value }))}
                onBlur={(e) =>
                  setValores((s) => ({ ...s, [chave]: aplicarFormatacao(e.target.value, tipo) }))
                }
                className={
                  vazio ? "border-[color:var(--missing)] bg-[color:var(--missing)]/5" : undefined
                }
                placeholder={opcional ? "sala, apto, bloco…" : "Preencher"}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Como sairá no contrato
        </div>
        <p className="mt-1 break-words text-sm text-foreground">
          {linhaMontada || <span className="text-muted-foreground">— preencha os campos —</span>}
        </p>
      </div>
    </div>
  );
}

function Linha({ ok, texto, aviso }: { ok: boolean; texto: string; aviso?: boolean }) {
  if (ok) {
    return (
      <div className="flex min-w-0 items-start gap-2 text-success">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="min-w-0 break-words">{texto}</span>
      </div>
    );
  }
  return (
    <div
      className={`flex min-w-0 items-start gap-2 ${aviso ? "text-warning-foreground" : "text-destructive"}`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 break-words">{texto}</span>
    </div>
  );
}

function base64ParaBlob(b64: string): Blob {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
