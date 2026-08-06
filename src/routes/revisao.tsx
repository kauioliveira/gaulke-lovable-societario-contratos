import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Eye,
  FileWarning,
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
    valores: Record<string, { valor: string; fonte: string; confianca: "alta" | "media" | "baixa" }>;
    faltantes: string[];
    conflitos: { campo: string; valores: { valor: string; fonte: string }[] }[];
    observacoes: string;
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
        year: "numeric", month: "2-digit", day: "2-digit",
      });
      const [d, m, a] = br.split("/");
      return `${a}-${m}-${d}`;
    })();
    const ehDataAtual = (nome: string) => {
      const n = nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[_\s]+/g, " ").trim();
      return /\bdata\b.*\b(atual|hoje|do dia|corrente|emiss[aã]o|gera[cç][aã]o)\b/.test(n)
        || /\b(data atual|data de hoje|data do dia|data corrente)\b/.test(n);
    };
    for (const ph of e.placeholders) {
      const chaveLimpa = ph.replace(/^__VERMELHO__::/, "");
      const valBruto = ehDataAtual(chaveLimpa)
        ? hojeISO
        : (e.extracao.valores[chaveLimpa]?.valor ?? "");
      iniciais[ph] = aplicarFormatacao(valBruto, ehDataAtual(chaveLimpa) ? "data" : detectarTipo(chaveLimpa));
    }
    setValores(iniciais);
    const metaTipo = e.extracao.valores["__META_TIPO_DOC_IDENTIDADE__"]?.valor;
    if (metaTipo === "CNH" || metaTipo === "RG") setTipoDocIdentidade(metaTipo);
  }, [navigate]);

  const placeholdersExibidos = useMemo(() => {
    if (!estado) return [];
    return estado.placeholders.map((ph) => {
      const original = ph.replace(/^__VERMELHO__::/, "");
      return {
        chave: ph,
        nome: original,
        rotulo: nomeAmigavel(ph),
        tipo: detectarTipo(original),
        ehVermelho: ph.startsWith("__VERMELHO__::"),
        fonte: estado.extracao.valores[original]?.fonte ?? "—",
        confianca: estado.extracao.valores[original]?.confianca ?? "baixa",
      };
    });
  }, [estado]);

  const estadoCivilChave = useMemo(
    () => placeholdersExibidos.find((p) => /estado.?civil/i.test(p.nome))?.chave,
    [placeholdersExibidos],
  );

  const isCasado = estadoCivilChave
    ? /casad/i.test(valores[estadoCivilChave] ?? "")
    : false;

  // Sincroniza campos "por extenso" com seus equivalentes numéricos
  const capitalChave = useMemo(
    () => placeholdersExibidos.find((p) => /capital.*social/i.test(p.nome) && !/extenso/i.test(p.nome))?.chave,
    [placeholdersExibidos],
  );
  const capitalExtensoChave = useMemo(
    () => placeholdersExibidos.find((p) => /capital.*social.*extenso/i.test(p.nome))?.chave,
    [placeholdersExibidos],
  );
  const quotasChave = useMemo(
    () => placeholdersExibidos.find((p) => /^quotas?$|n[uú]mero.*quotas?|quantidade.*quotas?/i.test(p.nome) && !/extenso/i.test(p.nome))?.chave,
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
    const lista: { campo: string; mensagem: string; tipo: "erro" | "aviso" }[] = [];
    for (const p of placeholdersExibidos) {
      const v = valores[p.chave] ?? "";
      if (!v.trim()) {
        lista.push({ campo: p.rotulo, mensagem: "Campo em branco", tipo: "erro" });
        continue;
      }
      if (p.tipo === "cpf" && !cpfValido(v))
        lista.push({ campo: p.rotulo, mensagem: "CPF inválido", tipo: "erro" });
      if (p.tipo === "cnpj" && !cnpjValido(v))
        lista.push({ campo: p.rotulo, mensagem: "CNPJ inválido", tipo: "erro" });
      if (p.tipo === "cep" && !/^\d{5}-\d{3}$/.test(v))
        lista.push({ campo: p.rotulo, mensagem: "CEP fora do padrão 00000-000", tipo: "aviso" });
    }
    if (isCasado && !regimeBens) {
      lista.push({
        campo: "Regime de bens",
        mensagem: "Selecione o regime de bens para sócio(s) casado(s).",
        tipo: "erro",
      });
    }
    return lista;
  }, [placeholdersExibidos, valores, isCasado, regimeBens]);

  const conflitos = estado?.extracao.conflitos ?? [];
  const faltantes = estado?.extracao.faltantes ?? [];
  const observacoes = estado?.extracao.observacoes ?? "";

  const podeGerar =
    problemas.filter((p) => p.tipo === "erro").length === 0 && estado !== null;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!estado) throw new Error("Estado não inicializado.");
      // Aplica formatação final antes do envio
      const valoresFinais: Record<string, string> = {};
      for (const p of placeholdersExibidos) {
        const bruto = valores[p.chave] ?? "";
        // Endereço da empresa: usa literalmente o que está no campo da tela
        // de revisão, sem reformatar (regra confirmada pelo usuário).
        valoresFinais[p.chave] =
          p.tipo === "enderecoEmpresa" ? bruto : aplicarFormatacao(bruto, p.tipo);
      }
      // Se houver placeholder de regime de bens, preencher
      const regimeKey = placeholdersExibidos.find((p) => /regime.*bens/i.test(p.nome))?.chave;
      if (regimeKey && regimeBens) valoresFinais[regimeKey] = regimeBens;

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
        setPreview({ html: value, base64 });
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
            </p>
          </div>
          <Button
            size="lg"
            disabled={!podeGerar || mutation.isPending || convertendoPreview}
            onClick={() => mutation.mutate()}
            className="bg-accent text-accent-foreground hover:bg-accent/90"
          >
            {mutation.isPending || convertendoPreview ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {convertendoPreview ? "Preparando prévia…" : "Gerando…"}
              </>
            ) : (
              <>
                <Eye className="mr-2 h-4 w-4" /> Pré-visualizar contrato
              </>
            )}
          </Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* Campos */}
          <div className="space-y-5">
            {isCasado && (
              <div className="rounded-xl border border-warning bg-warning/10 p-4">
                <Label className="mb-2 block text-sm font-semibold text-warning-foreground">
                  Regime de bens (obrigatório para sócio casado)
                </Label>
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
                  const v = valores[p.chave] ?? "";
                  const vazio = !v.trim();
                  const ehLongo = p.tipo === "objeto" || p.tipo === "endereco" || /extenso/i.test(p.nome);
                  const ehEstadoCivil = /estado.?civil/i.test(p.nome);
                  return (
                    <div
                      key={p.chave}
                      className={
                        ehLongo
                          ? "sm:col-span-2"
                          : ""
                      }
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <Label className="text-xs font-medium text-foreground">
                          {p.rotulo}
                          {p.ehVermelho && (
                            <Badge className="ml-2 bg-[color:var(--missing)] text-white">
                              vermelho
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
                          onValueChange={(novo) =>
                            setValores((s) => ({ ...s, [p.chave]: novo }))
                          }
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
                          onChange={(e) =>
                            setValores((s) => ({ ...s, [p.chave]: e.target.value }))
                          }
                          onBlur={(e) =>
                            setValores((s) => ({
                              ...s,
                              [p.chave]: aplicarFormatacao(e.target.value, p.tipo),
                            }))
                          }
                          rows={3}
                          className={
                            vazio
                              ? "border-[color:var(--missing)] bg-[color:var(--missing)]/5"
                              : ""
                          }
                          placeholder="Preencher manualmente"
                        />
                      ) : (
                        <Input
                          value={v}
                          onChange={(e) =>
                            setValores((s) => ({ ...s, [p.chave]: e.target.value }))
                          }
                          onBlur={(e) =>
                            setValores((s) => ({
                              ...s,
                              [p.chave]: aplicarFormatacao(e.target.value, p.tipo),
                            }))
                          }
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

          </div>

          {/* Painel lateral */}
          <aside className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-4">
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
              <div className="rounded-xl border border-warning bg-warning/10 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-warning-foreground">
                  <AlertTriangle className="h-4 w-4" /> Conflitos detectados
                </div>
                <ul className="space-y-2 text-xs text-foreground">
                  {conflitos.map((c, i) => (
                    <li key={i}>
                      <div className="font-medium">{c.campo}</div>
                      {c.valores.map((v, j) => (
                        <div key={j} className="text-muted-foreground">
                          • {v.valor} <span className="opacity-70">({v.fonte})</span>
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {faltantes.length > 0 && (
              <div className="rounded-xl border border-[color:var(--missing)] bg-[color:var(--missing)]/5 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[color:var(--missing)]">
                  <FileWarning className="h-4 w-4" /> Dados faltantes
                </div>
                <ul className="space-y-1 text-xs text-foreground">
                  {faltantes.map((f, i) => (
                    <li key={i}>• {nomeAmigavel(f)}</li>
                  ))}
                </ul>
              </div>
            )}

            {problemas.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Validações
                </h4>
                <ul className="space-y-1.5 text-xs">
                  {problemas.map((p, i) => (
                    <li
                      key={i}
                      className={
                        p.tipo === "erro" ? "text-destructive" : "text-warning-foreground"
                      }
                    >
                      • <span className="font-medium">{p.campo}:</span> {p.mensagem}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {observacoes && (
              <div className="rounded-xl border border-border bg-muted/40 p-4">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Observações da IA
                </h4>
                <p className="whitespace-pre-wrap text-xs text-foreground">{observacoes}</p>
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
              Confira o conteúdo abaixo. A formatação final no Word pode ter pequenas diferenças visuais
              (esta prévia é uma aproximação em HTML).
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto bg-white px-8 py-6 text-sm leading-relaxed text-black">
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

function Linha({
  ok,
  texto,
  aviso,
}: {
  ok: boolean;
  texto: string;
  aviso?: boolean;
}) {
  if (ok) {
    return (
      <div className="flex items-start gap-2 text-success">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{texto}</span>
      </div>
    );
  }
  return (
    <div
      className={`flex items-start gap-2 ${aviso ? "text-warning-foreground" : "text-destructive"}`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{texto}</span>
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
