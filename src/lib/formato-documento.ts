// Detecção do formato real do arquivo enviado como modelo de contrato.
// Roda no cliente e no servidor (puro, sem dependências de runtime).
//
// Por que existe: o .doc legado (Word 97-2003) é um container OLE2 que
// frequentemente embute um ZIP interno com os dados de tema. O pizzip consegue
// abrir esse ZIP embutido, não encontra "word/document.xml" e o resultado era
// "nenhum campo variável encontrado" — mensagem que sugere erro no modelo
// quando na verdade o problema é o formato do arquivo.

export type FormatoDocumento = "docx" | "doc" | "rtf" | "desconhecido";

// Assinaturas nos primeiros bytes, em base64 (3 bytes = 4 caracteres).
const ASSINATURAS: { formato: FormatoDocumento; prefixo: string }[] = [
  // PK\x03\x04 — qualquer ZIP; .docx é um ZIP OOXML
  { formato: "docx", prefixo: "UEsDB" },
  // D0 CF 11 E0 A1 B1 1A E1 — OLE2 Compound File (.doc, .xls, .ppt antigos)
  { formato: "doc", prefixo: "0M8R4KGxGuE" },
  // {\rtf
  { formato: "rtf", prefixo: "e1xydGY" },
];

export function detectarFormatoDocumento(base64: string): FormatoDocumento {
  const limpo = base64.replace(/^data:[^;]+;base64,/, "").trimStart();
  for (const { formato, prefixo } of ASSINATURAS) {
    if (limpo.startsWith(prefixo)) return formato;
  }
  return "desconhecido";
}

export const MENSAGEM_CONVERSAO_DOC =
  "Este modelo está no formato antigo .doc (Word 97-2003), que não pode ser " +
  "preenchido mantendo a formatação. Abra o arquivo no Word e use " +
  "Arquivo → Salvar como → Documento do Word (.docx), depois envie o .docx. " +
  "Os marcadores {{CAMPO}} e o texto em vermelho são preservados na conversão.";

export const MENSAGEM_FORMATO_INVALIDO =
  "O modelo enviado não é um documento Word válido. Envie um arquivo .docx " +
  "(Word 2007 ou mais recente).";
