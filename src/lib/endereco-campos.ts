// Campos sintéticos de endereço.
//
// O modelo de contrato costuma ter UM marcador com o endereço inteiro
// ({{ENDERECO_EMPRESA}}, {{ENDEREÇO_COMPLETO_COM_RUA_NUMERO_BAIRRO_CEP}}). Isso
// é ruim para conferência: o revisor recebe uma linha pronta e não tem como
// validar peça por peça.
//
// A solução é pedir os componentes separados à IA, sob nomes sintéticos que não
// existem no Word, revisar cada um, e só na geração remontar a linha e gravá-la
// no marcador composto. Mesmo padrão do `__META_TIPO_DOC_IDENTIDADE__`.
//
// Módulo puro: usado no servidor (montagem do prompt) e no cliente (tela de
// revisão).

import type { ComponentesEndereco } from "./formatters";

export type EscopoEndereco = "socio" | "empresa";

export const PECAS_ENDERECO = [
  "LOGRADOURO",
  "NUMERO",
  "COMPLEMENTO",
  "BAIRRO",
  "CIDADE",
  "UF",
  "CEP",
] as const;

export type PecaEndereco = (typeof PECAS_ENDERECO)[number];

/** Rótulo e tipo de formatação de cada peça, para a tela de revisão. */
export const ROTULO_PECA: Record<PecaEndereco, { rotulo: string; tipo: string }> = {
  LOGRADOURO: { rotulo: "Logradouro", tipo: "tituloSimples" },
  NUMERO: { rotulo: "Nº", tipo: "numero" },
  COMPLEMENTO: { rotulo: "Complemento", tipo: "tituloSimples" },
  BAIRRO: { rotulo: "Bairro", tipo: "bairro" },
  CIDADE: { rotulo: "Cidade", tipo: "cidade" },
  UF: { rotulo: "UF", tipo: "uf" },
  CEP: { rotulo: "CEP", tipo: "cep" },
};

function prefixo(escopo: EscopoEndereco): string {
  return escopo === "socio" ? "__ENDSOCIO_" : "__ENDEMPRESA_";
}

export function chavePeca(escopo: EscopoEndereco, peca: PecaEndereco): string {
  return `${prefixo(escopo)}${peca}__`;
}

export function chavesDoEscopo(escopo: EscopoEndereco): string[] {
  return PECAS_ENDERECO.map((p) => chavePeca(escopo, p));
}

/** `true` para qualquer chave sintética de endereço. */
export function ehChaveDeEndereco(chave: string): boolean {
  return chave.startsWith("__ENDSOCIO_") || chave.startsWith("__ENDEMPRESA_");
}

/** Lê as peças de um dicionário de valores para o formato de `formatters`. */
export function lerComponentes(
  valores: Record<string, string>,
  escopo: EscopoEndereco,
): ComponentesEndereco {
  const ler = (p: PecaEndereco) => (valores[chavePeca(escopo, p)] ?? "").trim();
  return {
    logradouro: ler("LOGRADOURO"),
    numero: ler("NUMERO"),
    complemento: ler("COMPLEMENTO"),
    bairro: ler("BAIRRO"),
    cidade: ler("CIDADE"),
    uf: ler("UF"),
    cep: ler("CEP"),
  };
}

/** Grava as peças decompostas de volta no dicionário de valores. */
export function gravarComponentes(
  destino: Record<string, string>,
  escopo: EscopoEndereco,
  c: ComponentesEndereco,
): void {
  destino[chavePeca(escopo, "LOGRADOURO")] = c.logradouro;
  destino[chavePeca(escopo, "NUMERO")] = c.numero;
  destino[chavePeca(escopo, "COMPLEMENTO")] = c.complemento;
  destino[chavePeca(escopo, "BAIRRO")] = c.bairro;
  destino[chavePeca(escopo, "CIDADE")] = c.cidade;
  destino[chavePeca(escopo, "UF")] = c.uf;
  destino[chavePeca(escopo, "CEP")] = c.cep;
}

/** Trecho do prompt que descreve as peças pedidas para um escopo. */
export function instrucoesPrompt(escopo: EscopoEndereco): string {
  const quem = escopo === "socio" ? "do SÓCIO (pessoa física)" : "da EMPRESA (sede)";
  return `Componentes do endereço ${quem} — retorne cada peça SEPARADA, sem repetir rótulo:
${chavePeca(escopo, "LOGRADOURO")} → tipo da via POR EXTENSO + nome, sem número.
   Documentos abreviam ("R LEONARDO KRAINSKI", "AV. BRASIL", "EST IVO EISELT");
   expanda sempre: R/R. → "Rua", AV/AV. → "Avenida", EST → "Estrada",
   ROD → "Rodovia", TV → "Travessa", AL → "Alameda", PC/PÇ → "Praça".
   Ex.: "R LEONARDO KRAINSKI" → "Rua Leonardo Krainski".
   Se o documento não indicar o tipo, use "Rua".
${chavePeca(escopo, "NUMERO")} → só o número do imóvel (ex.: "380"); "S/N" se não houver
${chavePeca(escopo, "COMPLEMENTO")} → sala/apto/bloco, ou vazio
${chavePeca(escopo, "BAIRRO")} → só o nome do bairro (ex.: "Rio Vermelho Estação")
${chavePeca(escopo, "CIDADE")} → só o nome do município
${chavePeca(escopo, "UF")} → sigla de 2 letras (ex.: "SC")
${chavePeca(escopo, "CEP")} → só os 8 dígitos, sem pontuação`;
}
