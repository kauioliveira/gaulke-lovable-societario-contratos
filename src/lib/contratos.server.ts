// Lógica do gerador de contratos — só executa no servidor.
// docxtemplater + pizzip são JS puro, sem dependência de binário.

import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import {
  detectarFormatoDocumento,
  MENSAGEM_CONVERSAO_DOC,
  MENSAGEM_FORMATO_INVALIDO,
} from "./formato-documento";
import type { EstruturaModelo } from "./diagnostico-modelo";
import { detectarTipo } from "./formatters";
import {
  ehChaveDeEndereco,
  instrucoesPrompt,
  chavesDoEscopo,
  type EscopoEndereco,
} from "./endereco-campos";

const DOCUMENT_XML = "word/document.xml";

// ---------- Helpers de base64 ----------

function base64ParaBuffer(b64: string): Uint8Array {
  // remove eventual prefixo data:
  const limpo = b64.replace(/^data:[^;]+;base64,/, "");
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(limpo, "base64"));
  }
  const bin = atob(limpo);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bufferParaBase64(buf: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(buf).toString("base64");
  }
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

// ---------- Abertura validada do .docx ----------
// Valida o formato ANTES de tentar abrir: um .doc legado é um container OLE2
// que costuma embutir um ZIP de tema, então o pizzip abre sem erro e só depois
// descobriríamos que não há "word/document.xml".

function abrirDocx(templateBase64: string): PizZip {
  const formato = detectarFormatoDocumento(templateBase64);
  if (formato === "doc") throw new Error(MENSAGEM_CONVERSAO_DOC);
  if (formato !== "docx") throw new Error(MENSAGEM_FORMATO_INVALIDO);

  let zip: PizZip;
  try {
    zip = new PizZip(base64ParaBuffer(templateBase64));
  } catch {
    throw new Error(MENSAGEM_FORMATO_INVALIDO);
  }
  if (!zip.file(DOCUMENT_XML)) throw new Error(MENSAGEM_FORMATO_INVALIDO);
  return zip;
}

// ---------- Consolidar runs do Word ----------
// O Word quebra um mesmo {{TAG}} entre vários <w:r> (verificação ortográfica,
// revisões). Para DETECTAR placeholders basta concatenar o texto do parágrafo —
// não reescrevemos o XML nessa etapa.

function textoCompletoDoParagrafo(pXml: string): string {
  const matches = [...pXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)];
  return matches.map((m) => m[1]).join("");
}

// ---------- Detecção de placeholders ----------

// Chaves quebradas: `{{CAMPO}`, `{CAMPO}}`, `{CAMPO}`, `{{CAMPO`. Nenhuma delas
// é preenchida pelo docxtemplater — o campo sairia literal no contrato final,
// sem nenhum aviso. Procuramos no texto JÁ CONSOLIDADO do parágrafo, depois de
// remover as chaves bem formadas.
function chavesMalformadas(textoParagrafo: string): string[] {
  const resto = textoParagrafo.replace(/\{\{\s*[^{}]+?\s*\}\}/g, "");
  if (!/[{}]/.test(resto)) return [];
  return [...resto.matchAll(/\{+[^{}]{0,60}\}*|\{*[^{}]{0,60}\}+/g)]
    .map((m) => m[0].trim())
    .filter((t) => /[{}]/.test(t));
}

export async function extrairPlaceholders(templateBase64: string): Promise<EstruturaModelo> {
  // .doc legado é convertido aqui, uma única vez. O .docx resultante volta ao
  // cliente e passa a ser O modelo — a geração final não converte de novo, nem
  // corre o risco de trabalhar sobre um arquivo diferente do que foi analisado.
  const template = await normalizarParaDocx(templateBase64);

  const zip = abrirDocx(template);
  const xml = zip.file(DOCUMENT_XML)?.asText() ?? "";

  const encontrados = new Set<string>();
  const malformados: string[] = [];

  // 1) Placeholders {{...}} — varrer parágrafo por parágrafo (texto consolidado)
  const paragrafos = [...xml.matchAll(/<w:p[\s>][^]*?<\/w:p>/g)];
  for (const p of paragrafos) {
    const txt = textoCompletoDoParagrafo(p[0]);
    const tags = [...txt.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)];
    for (const t of tags) {
      encontrados.add(t[1].trim());
    }
    malformados.push(...chavesMalformadas(txt));
  }

  // 2) Runs com cor vermelha (FF0000 / C00000 / ED1C24) e texto não vazio
  const runRegex = /<w:r[\s>][^]*?<\/w:r>/g;
  const coresVermelhas = /(FF0000|C00000|ED1C24|E81123|DC143C)/i;
  for (const m of xml.matchAll(runRegex)) {
    const r = m[0];
    if (!coresVermelhas.test(r)) continue;
    const textos = [...r.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join("");
    const limpo = textos.trim();
    if (limpo && !encontrados.has(limpo)) {
      // Marca como [VERMELHO] nome para diferenciar
      encontrados.add(`__VERMELHO__::${limpo}`);
    }
  }

  // Ordem estável (insertion order garantido em Set)
  const convertidoDeDoc = template !== templateBase64;
  return {
    placeholders: [...encontrados],
    malformados: [...new Set(malformados)],
    // Só devolve o arquivo quando ele mudou; senão o cliente reusa o que já tem.
    templateBase64: convertidoDeDoc ? template : "",
    convertidoDeDoc,
  };
}

// Aceita .doc convertendo para .docx quando o ambiente permite; devolve o
// próprio arquivo quando já é .docx.
async function normalizarParaDocx(templateBase64: string): Promise<string> {
  if (detectarFormatoDocumento(templateBase64) !== "doc") return templateBase64;

  const { converterDocParaDocx } = await import("./conversao-doc.server");
  const convertido = await converterDocParaDocx(templateBase64);
  if (!convertido) throw new Error(MENSAGEM_CONVERSAO_DOC);
  if (detectarFormatoDocumento(convertido) !== "docx") throw new Error(MENSAGEM_CONVERSAO_DOC);
  return convertido;
}

// ---------- IA: extração estruturada ----------

export type Confianca = "alta" | "media" | "baixa";

export type Conflito = {
  campo: string;
  valores: { valor: string; fonte: string }[];
};

// Schema da resposta, em modo estrito. Duas restrições do strict mode moldam o
// formato: nada de dicionário com chaves livres (por isso `campos` é lista, e
// não um objeto indexado pelo nome do campo) e TODA propriedade precisa estar em
// `required` com `additionalProperties: false`.
const ESQUEMA_EXTRACAO = {
  nome: "extracao_contrato",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["campos", "faltantes", "conflitos", "observacoes"],
    properties: {
      campos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["nome", "valor", "fonte", "confianca"],
          properties: {
            nome: { type: "string", description: "Nome do campo exatamente como listado" },
            valor: { type: "string", description: "Valor extraído; vazio se não encontrado" },
            fonte: { type: "string", description: "Nome do arquivo de onde saiu o valor" },
            confianca: { type: "string", enum: ["alta", "media", "baixa"] },
          },
        },
      },
      faltantes: { type: "array", items: { type: "string" } },
      conflitos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["campo", "valores"],
          properties: {
            campo: { type: "string" },
            valores: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["valor", "fonte"],
                properties: { valor: { type: "string" }, fonte: { type: "string" } },
              },
            },
          },
        },
      },
      observacoes: { type: "string" },
    },
  },
} as const;

export async function extrairValoresViaIA(
  placeholders: string[],
  arquivos: { nome: string; mime: string; base64: string }[],
): Promise<{
  valores: Record<string, { valor: string; fonte: string; confianca: "alta" | "media" | "baixa" }>;
  faltantes: string[];
  conflitos: Conflito[];
  observacoes: string;
  tokens: number;
}> {
  const placeholdersLimpos = placeholders.map((p) => p.replace(/^__VERMELHO__::/, ""));

  // Quando o modelo tem um marcador de endereço composto, pedimos também as
  // peças separadas — é o que permite conferir e validar rua, número, bairro,
  // cidade, UF e CEP um a um na revisão. A linha final é remontada na geração.
  const escoposEndereco: EscopoEndereco[] = [];
  for (const ph of placeholdersLimpos) {
    const tipo = detectarTipo(ph);
    if (tipo === "enderecoSocio" && !escoposEndereco.includes("socio")) {
      escoposEndereco.push("socio");
    }
    if (tipo === "enderecoEmpresa" && !escoposEndereco.includes("empresa")) {
      escoposEndereco.push("empresa");
    }
  }

  const promptSistema = `Você é um assistente especialista em direito societário brasileiro da Gaulke Contábil.
Sua tarefa é extrair dados de empresa e sócios a partir de documentos (viabilidade, DBE, ficha cadastral, RG, CNH, comprovante de residência, contratos anteriores) para preencher um contrato social.

REGRAS RIGOROSAS:
1. NUNCA invente dados. Se não encontrar evidência clara, retorne valor vazio "" e marque o campo em "faltantes".
2. Se documentos diferentes trouxerem valores conflitantes para o mesmo campo, registre em "conflitos" (NÃO escolha um — peça revisão humana).
3. Sempre identifique a "fonte" (nome do arquivo) de onde extraiu cada valor.
4. Para CPF/CNPJ/CEP retorne apenas os dígitos (sem pontuação) — o sistema formata depois.
5. Para datas retorne ISO YYYY-MM-DD.
6. Para nomes próprios e razão social: mantenha caixa correta (Title Case). O sistema aplicará caixa alta + negrito na razão social e nos nomes de sócios automaticamente — você só precisa retornar o nome correto.
6.1. OBJETO SOCIAL (cláusula quarta) — REGRA CRÍTICA:
   - Extraia SEMPRE do documento REGIN (Viabilidade / Consulta de Viabilidade / Protocolo REGIN / DBE quando trouxer REGIN), da seção com título "DESCRIÇÃO DO OBJETO SOCIAL" (ou "Objeto Social" / "Objeto da Empresa").
   - O REGIN apresenta o rótulo "DESCRIÇÃO DO OBJETO SOCIAL" e, na(s) linha(s) seguinte(s), o texto da(s) atividade(s) em CAIXA ALTA. Exemplo:
        DESCRIÇÃO DO OBJETO SOCIAL
        FABRICAÇÃO DE ARTEFATOS DE CIMENTO
     Nesse caso o objeto social é "fabricação de artefatos de cimento".
   - Copie o texto INTEGRAL e LITERAL dessa seção (todas as linhas até o próximo rótulo/seção do REGIN), sem resumir, sem reordenar, sem remover atividades, sem acrescentar palavras.
   - Ignore códigos CNAE, cabeçalhos e o próprio rótulo "DESCRIÇÃO DO OBJETO SOCIAL" — retorne apenas o texto descritivo das atividades.
   - Retorne em MINÚSCULAS (o sistema aplica Title Case depois; apenas iniciais de cada atividade ficam maiúsculas).
   - Se o REGIN não estiver entre os arquivos anexados, deixe o campo vazio e adicione em "faltantes" + "observacoes" avisando que o REGIN é necessário. NUNCA invente objeto social a partir de outros documentos.
7. Para objeto social: retorne em minúsculas (o sistema aplica Title Case com preposições corretas depois).
8. ENDEREÇOS — NÃO monte a linha do endereço. Preencha os campos de COMPONENTE
   (nomes começando com __ENDSOCIO_ / __ENDEMPRESA_) listados na mensagem do
   usuário, cada peça isolada e sem rótulo. O sistema monta a linha final.
   - Se o modelo também tiver um campo de endereço "inteiro", deixe-o VAZIO:
     preenchê-lo duplicaria o texto no contrato.
   - Endereço do SÓCIO vem do comprovante de residência / CNH / RG.
   - Endereço da EMPRESA vem do REGIN / DBE / ficha cadastral — é a sede, e
     costuma ser diferente do endereço do sócio.
9. Profissão padrão: "empresário(a)" se não houver outra informação clara.
10. Nacionalidade padrão: "brasileiro(a)" se não houver outra informação clara.
11. PLACEHOLDERS-RÓTULO (CRÍTICO — evita duplicação de texto no contrato):
    O modelo Word frequentemente tem placeholders em vermelho cujo TEXTO é apenas
    um rótulo/etiqueta do campo, e o próprio modelo já contém o rótulo fixo antes
    do placeholder. Exemplos comuns que aparecem como nome de campo:
      "Bairro", "bairro", "Cep", "CEP", "Nº", "Numero", "Número", "Rua",
      "Logradouro", "Cidade", "Município", "UF", "Estado", "Endereço",
      "Razão Social", "Nome Empresarial", "Nome Fantasia".
    Nestes casos NUNCA repita o rótulo no valor. Retorne SOMENTE o dado puro:
      • "Bairro" → apenas o nome do bairro (ex.: "Sertãozinho")
      • "Cep" ou "CEP" → apenas o CEP formatado (ex.: "89.293-899") ou só os
        dígitos quando o campo for claramente numérico
      • "Nº", "Numero", "Número" → apenas o número do imóvel (ex.: "380")
      • "Rua" / "Logradouro" → apenas o nome do logradouro com o tipo, sem
        bairro/CEP/cidade (ex.: "Estrada Ivo Eiselt")
      • "Cidade" / "Município" → apenas o nome da cidade
      • "UF" / "Estado" → apenas a sigla (ex.: "SC")
      • "Endereço" (sozinho, sem qualificadores) → endereço COMPLETO formatado
        somente se o modelo NÃO tiver outros placeholders de bairro/CEP/nº/cidade
        próximos; caso contrário deixe vazio.
    Se houver dúvida entre preencher um placeholder unificado de endereço ou
    placeholders individuais (bairro, cep, nº, cidade, UF), prefira SEMPRE
    preencher os individuais e deixar o unificado vazio — assim evitamos texto
    duplicado no contrato final.
12. Resposta DEVE ser JSON válido, sem cercas markdown, sem comentários.`;

  const promptUsuario = `Extraia os seguintes campos do contrato (nomes como aparecem no modelo):

${placeholdersLimpos.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Além dos campos acima, SEMPRE retorne também o campo especial
"__META_TIPO_DOC_IDENTIDADE__" com valor "CNH" se o documento de identificação
do(s) sócio(s) anexado for uma Carteira Nacional de Habilitação, ou "RG" se
for uma Carteira de Identidade / RG. Se não conseguir determinar, retorne "".
${escoposEndereco.map((e) => `\n${instrucoesPrompt(e)}`).join("\n")}

Retorne EXATAMENTE este JSON:
{
  "campos": [
    { "nome": "<nome do campo>", "valor": "<string>", "fonte": "<nome do arquivo>", "confianca": "alta|media|baixa" }
  ],
  "faltantes": ["<nome do campo>"],
  "conflitos": [
    { "campo": "<nome>", "valores": [{ "valor": "...", "fonte": "..." }] }
  ],
  "observacoes": "<texto curto explicando ambiguidades, ilegibilidade ou observações relevantes>"
}

Inclua em "campos" TODOS os campos listados acima, mesmo os que não encontrou
(nesses, "valor" vazio e "confianca": "baixa").`;

  // Conteúdo multimodal no formato do /v1/chat/completions da OpenAI: imagens
  // como image_url e PDFs como file part. Em PDF a API extrai o texto E renderiza
  // as páginas como imagem, então documento escaneado é lido pela via de visão —
  // não precisamos de OCR separado.
  const content: Array<Record<string, unknown>> = [{ type: "text", text: promptUsuario }];
  for (const arq of arquivos) {
    if (arq.mime.startsWith("image/")) {
      content.push({
        type: "image_url",
        image_url: { url: `data:${arq.mime};base64,${arq.base64}` },
      });
    } else {
      // PDF e outros documentos
      content.push({
        type: "file",
        file: {
          filename: arq.nome,
          file_data: `data:${arq.mime};base64,${arq.base64}`,
        },
      });
    }
  }

  const { completarComEsquema } = await import("./openai.server");
  const { texto, tokens, comEsquema } = await completarComEsquema(
    promptSistema,
    content,
    ESQUEMA_EXTRACAO,
  );
  console.info(
    `Extração concluída: ${tokens} tokens${comEsquema ? "" : " (sem esquema estrito)"}.`,
  );

  type CampoExtraido = { nome: string; valor: string; fonte: string; confianca: Confianca };
  let parsed: {
    campos?: CampoExtraido[];
    faltantes?: string[];
    conflitos?: Conflito[];
    observacoes?: string;
  };
  try {
    // Com structured outputs o texto já vem como JSON puro. A remoção de cercas
    // markdown continua aqui para o caminho de fallback sem esquema estrito.
    parsed = JSON.parse(texto.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, ""));
  } catch (e) {
    throw new Error(
      `A IA retornou um JSON inválido. Tente novamente. Detalhe: ${(e as Error).message}`,
    );
  }

  // Lista → dicionário indexado pelo nome do campo, que é o formato que o
  // restante do sistema consome. A lista existe só porque o modo estrito do
  // structured outputs não aceita objeto com chaves arbitrárias.
  const valoresDaIA: Record<string, { valor: string; fonte: string; confianca: Confianca }> = {};
  for (const campo of parsed.campos ?? []) {
    if (!campo?.nome) continue;
    valoresDaIA[campo.nome] = {
      valor: campo.valor ?? "",
      fonte: campo.fonte || "—",
      confianca: campo.confianca ?? "baixa",
    };
  }

  // Normalizar — garantir que TODOS os placeholders apareçam nos valores
  const valoresFinais: Record<string, { valor: string; fonte: string; confianca: Confianca }> = {};
  for (const ph of placeholdersLimpos) {
    // Campos de data atual são sempre preenchidos com a data de hoje (Brasil),
    // ignorando o que a IA tenha encontrado nos documentos.
    const phNorm = ph
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[_\s]+/g, " ")
      .trim();
    if (
      /\bdata\b.*\b(atual|hoje|de hoje|do dia|corrente|emiss[aã]o|gera[cç][aã]o)\b/.test(phNorm) ||
      /\b(data atual|data de hoje|data do dia|data corrente)\b/.test(phNorm)
    ) {
      const hoje = new Date().toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      // hoje vem como dd/mm/aaaa — convertemos para ISO p/ o formatter aplicar dd/mm/aaaa depois
      const [d, m, a] = hoje.split("/");
      valoresFinais[ph] = {
        valor: `${a}-${m}-${d}`,
        fonte: "Data de geração do contrato",
        confianca: "alta",
      };
      continue;
    }
    valoresFinais[ph] = valoresDaIA[ph] ?? { valor: "", fonte: "—", confianca: "baixa" };
  }

  // Propagar campos sintéticos: meta (__META_*) e componentes de endereço
  // (__ENDSOCIO_*, __ENDEMPRESA_*). Não são placeholders do Word, então não
  // entram no laço acima, mas a tela de revisão precisa deles.
  for (const [k, v] of Object.entries(valoresDaIA)) {
    if ((k.startsWith("__META_") || ehChaveDeEndereco(k)) && !valoresFinais[k]) {
      valoresFinais[k] = v;
    }
  }

  // Se a IA ignorou os componentes e devolveu só a linha inteira, decompomos
  // aqui — assim a tela sempre tem as peças para conferir.
  for (const escopo of escoposEndereco) {
    const chaves = chavesDoEscopo(escopo);
    if (chaves.some((c) => valoresFinais[c]?.valor?.trim())) continue;

    const tipoAlvo = escopo === "socio" ? "enderecoSocio" : "enderecoEmpresa";
    const composto = placeholdersLimpos.find((p) => detectarTipo(p) === tipoAlvo);
    const linha = composto ? (valoresFinais[composto]?.valor ?? "") : "";
    if (!linha.trim()) continue;

    const { decomporEndereco } = await import("./formatters");
    const { gravarComponentes } = await import("./endereco-campos");
    const pecas: Record<string, string> = {};
    gravarComponentes(pecas, escopo, decomporEndereco(linha));
    const fonte = composto ? (valoresFinais[composto]?.fonte ?? "—") : "—";
    for (const [k, valor] of Object.entries(pecas)) {
      valoresFinais[k] = { valor, fonte, confianca: "media" };
    }
  }

  return {
    valores: valoresFinais,
    faltantes: parsed.faltantes ?? placeholdersLimpos.filter((p) => !valoresFinais[p]?.valor),
    conflitos: parsed.conflitos ?? [],
    observacoes: parsed.observacoes ?? "",
    tokens,
  };
}

// ---------- Geração do .docx ----------

export async function gerarDocxPreenchido(
  templateBase64: string,
  valores: Record<string, string>,
): Promise<string> {
  const zip = abrirDocx(templateBase64);

  // 0) Aplicar regras de caixa alta para razão social e nomes de sócios
  const valoresTransformados: Record<string, string> = {};
  for (const [k, v] of Object.entries(valores)) {
    const nomeCampo = k.replace(/^__VERMELHO__::/, "");
    if (v && ehCampoEmpresaOuSocio(nomeCampo)) {
      valoresTransformados[k] = v.toLocaleUpperCase("pt-BR");
    } else {
      valoresTransformados[k] = v ?? "";
    }
  }

  // 1) Substituir runs em vermelho cujo texto bate com algum valor (chave __VERMELHO__::texto)
  //    e também preencher placeholders simples no XML (para tolerância a docxtemplater split).
  let xml = zip.file(DOCUMENT_XML)?.asText() ?? "";

  // 0.1) Remover texto espúrio "26" (resíduo do modelo) imediatamente antes de "CONTRATO SOCIAL"
  xml = xml.replace(
    /(<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:t[^>]*>)26(<\/w:t>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>)(\s*<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:t[^>]*>CONTRATO SOCIAL)/,
    "$1$2$3",
  );

  // 0.2) Limpeza do preâmbulo do sócio:
  //   a) remover trecho fixo residual ", nº 266, Bairro Rio Vermelho Estação, CEP 89.292-580"
  //      que aparece logo após o placeholder de endereço no modelo (vestígio do contrato anterior)
  xml = limparTextoConsolidado(
    xml,
    /,\s*nº\s*266,\s*Bairro\s+Rio\s+Vermelho\s+Estação,\s*CEP\s*89\.292-580/gi,
    "",
  );
  //   b) ajustar o tipo do documento de identificação conforme o que foi extraído:
  //      - CNH  → "Carteira Nacional de Habilitação"
  //      - RG   → "Carteira de Identidade"
  //      - desconhecido → "Carteira Nacional de Habilitação ou Carteira de Identidade"
  const tipoDoc = (valores["__META_TIPO_DOC_IDENTIDADE__"] ?? "").toUpperCase().trim();
  const textoDoc =
    tipoDoc === "CNH"
      ? "Carteira Nacional de Habilitação"
      : tipoDoc === "RG"
        ? "Carteira de Identidade"
        : "Carteira Nacional de Habilitação ou Carteira de Identidade";
  // Normaliza qualquer variação que possa estar no modelo para o texto correto + ", nº"
  xml = limparTextoConsolidado(
    xml,
    /Carteira Nacional de Habilitação(?:\s+ou\s+Carteira de Identidade(?:\s+se\s+caso\s+for)?)?\s*,?\s*nº/gi,
    `${textoDoc}, nº`,
  );
  xml = limparTextoConsolidado(
    xml,
    /Carteira de Identidade(?:\s+ou\s+Carteira Nacional de Habilitação(?:\s+se\s+caso\s+for)?)?\s*,?\s*nº/gi,
    `${textoDoc}, nº`,
  );

  // Forçar negrito nos runs que contêm {{TAG}} de razão social / sócio
  const tagsNegrito = Object.keys(valoresTransformados).filter(
    (k) => !k.startsWith("__VERMELHO__::") && ehCampoEmpresaOuSocio(k),
  );
  xml = forcarNegritoEmTags(xml, tagsNegrito);

  // Substituir conteúdo de runs vermelhos cujo texto-normalizado seja uma chave conhecida
  xml = substituirRunsVermelhos(xml, valoresTransformados);

  zip.file(DOCUMENT_XML, xml);

  // 2) Rodar docxtemplater com delimitadores {{ }} para placeholders restantes
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{{", end: "}}" },
    nullGetter(part: { value: string }) {
      return `{{${part.value}}}`;
    },
  });

  const dados: Record<string, string> = {};
  for (const [k, v] of Object.entries(valoresTransformados)) {
    dados[k] = v ?? "";
    dados[k.trim()] = v ?? "";
  }

  try {
    doc.render(dados);
  } catch (e) {
    const errMsg = (e as Error).message;
    console.error("docxtemplater erro:", errMsg);
    let xmlAtual = zip.file(DOCUMENT_XML)?.asText() ?? "";
    xmlAtual = substituirPlaceholdersManual(xmlAtual, dados);
    zip.file(DOCUMENT_XML, xmlAtual);
  }

  const out: Uint8Array = doc.getZip().generate({ type: "uint8array" });
  return bufferParaBase64(out);
}

// Detecta se o campo é razão social / nome empresarial / sócio (uppercase + bold)
function ehCampoEmpresaOuSocio(nome: string): boolean {
  const n = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .trim();
  if (/\b(razao social|nome empresarial|denominacao social)\b/.test(n)) return true;
  if (/\bsocio\b|\bsocia\b/.test(n)) return true;
  if (/\bnome (do |da )?(socio|socia|administrador|administradora)\b/.test(n)) return true;
  return false;
}

// Garante <w:b/> dentro do <w:rPr> dos runs que contenham qualquer um dos placeholders {{tag}}
function forcarNegritoEmTags(xml: string, tags: string[]): string {
  if (tags.length === 0) return xml;
  return xml.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (run) => {
    const contem = tags.some((tag) => {
      const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\{\\{\\s*${esc}\\s*\\}\\}`).test(run);
    });
    if (!contem) return run;
    return adicionarNegritoEmRun(run);
  });
}

function adicionarNegritoEmRun(run: string): string {
  const rPrMatch = run.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
  if (rPrMatch) {
    if (/<w:b\s*\/?>/.test(rPrMatch[1])) return run;
    return run.replace(rPrMatch[0], `<w:rPr><w:b/><w:bCs/>${rPrMatch[1]}</w:rPr>`);
  }
  return run.replace(/(<w:r\b[^>]*>)/, `$1<w:rPr><w:b/><w:bCs/></w:rPr>`);
}

// Aplica regex sobre o TEXTO CONSOLIDADO de cada parágrafo, removendo/substituindo
// caracteres mesmo quando o trecho está dividido entre vários <w:t>.
function limparTextoConsolidado(xml: string, padrao: RegExp, substituto: string): string {
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragrafo) => {
    const slots: { offset: number; texto: string }[] = [];
    const tRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let consolidado = "";
    let m: RegExpExecArray | null;
    while ((m = tRegex.exec(paragrafo)) !== null) {
      slots.push({ offset: consolidado.length, texto: m[1] });
      consolidado += m[1];
    }
    if (!padrao.test(consolidado)) return paragrafo;
    padrao.lastIndex = 0;

    const ocorrencias: { start: number; end: number; replacement: string }[] = [];
    let mm: RegExpExecArray | null;
    while ((mm = padrao.exec(consolidado)) !== null) {
      ocorrencias.push({ start: mm.index, end: mm.index + mm[0].length, replacement: substituto });
      if (mm[0].length === 0) padrao.lastIndex++;
    }
    if (ocorrencias.length === 0) return paragrafo;

    const modificados = new Array<boolean>(slots.length).fill(false);
    const novosTextos = slots.map((s) => s.texto);
    for (const oc of ocorrencias) {
      let inserido = false;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const slotInicio = s.offset;
        const slotFim = s.offset + s.texto.length;
        if (slotFim <= oc.start || slotInicio >= oc.end) continue;
        const localStart = Math.max(0, oc.start - slotInicio);
        const localEnd = Math.min(s.texto.length, oc.end - slotInicio);
        const antes = novosTextos[i].slice(0, localStart);
        const depois = novosTextos[i].slice(localEnd);
        novosTextos[i] = antes + (inserido ? "" : oc.replacement) + depois;
        inserido = true;
        modificados[i] = true;
      }
    }

    let idx = 0;
    return paragrafo.replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, (full) => {
      const i = idx++;
      if (!modificados[i]) return full;
      const novo = escapeXml(novosTextos[i]);
      return full.replace(/>[^<]*</, `>${novo}<`);
    });
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function substituirRunsVermelhos(xml: string, valores: Record<string, string>): string {
  const coresVermelhas = /(FF0000|C00000|ED1C24|E81123|DC143C)/i;
  return xml.replace(/<w:r[\s>][^]*?<\/w:r>/g, (run) => {
    if (!coresVermelhas.test(run)) return run;
    const textos = [...run.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)];
    if (textos.length === 0) return run;
    const textoTotal = textos
      .map((t) => t[1])
      .join("")
      .trim();
    if (!textoTotal) return run;
    const chave = `__VERMELHO__::${textoTotal}`;
    const v = valores[chave] ?? valores[textoTotal];
    if (!v) return run; // mantém em vermelho original
    // Se o texto-placeholder original descreve razão social ou sócio, força negrito
    let runFinal = ehCampoEmpresaOuSocio(textoTotal) ? adicionarNegritoEmRun(run) : run;
    // Substituir todos os <w:t> deste run: primeiro com valor, demais vazios
    let primeiro = true;
    return runFinal.replace(/(<w:t[^>]*>)([^<]*)(<\/w:t>)/g, (_m, abre, _meio, fecha) => {
      if (primeiro) {
        primeiro = false;
        return `${abre}${escapeXml(v)}${fecha}`;
      }
      return `${abre}${fecha}`;
    });
  });
}

function substituirPlaceholdersManual(xml: string, dados: Record<string, string>): string {
  // Substitui {{NOME}} no texto consolidado de cada <w:t>. Não é perfeito quando o tag
  // se quebra em runs, mas serve como fallback quando docxtemplater falhar.
  for (const [k, v] of Object.entries(dados)) {
    if (k.startsWith("__VERMELHO__::")) continue;
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\{\\{\\s*${esc}\\s*\\}\\}`, "g");
    xml = xml.replace(re, escapeXml(v));
  }
  return xml;
}
