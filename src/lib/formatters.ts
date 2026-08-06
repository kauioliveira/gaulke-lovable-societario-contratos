// Formatadores pt-BR — Gaulke Contábil

const apenasDigitos = (v: string) => v.replace(/\D/g, "");

export function formatarCPF(valor: string): string {
  const d = apenasDigitos(valor);
  if (d.length !== 11) return valor;
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

export function formatarCNPJ(valor: string): string {
  const d = apenasDigitos(valor);
  if (d.length !== 14) return valor;
  return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

export function formatarCEP(valor: string): string {
  const d = apenasDigitos(valor);
  if (d.length !== 8) return valor;
  return d.replace(/(\d{5})(\d{3})/, "$1-$2");
}

export function formatarTelefone(valor: string): string {
  const d = apenasDigitos(valor);
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return valor;
}

export function formatarMoeda(valor: number | string): string {
  const n =
    typeof valor === "number" ? valor : Number(String(valor).replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n)) return String(valor);
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

export function formatarData(valor: string): string {
  // aceita ISO ou dd/mm/aaaa
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(valor)) return valor;
  const m = valor.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return valor;
}

// Validação básica de CPF (algoritmo dos dígitos)
export function cpfValido(valor: string): boolean {
  const d = apenasDigitos(valor);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (base: string, mult: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (mult - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = calc(d.slice(0, 9), 10);
  const d2 = calc(d.slice(0, 10), 11);
  return d1 === Number(d[9]) && d2 === Number(d[10]);
}

export function cnpjValido(valor: string): boolean {
  const d = apenasDigitos(valor);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (base: string, pesos: number[]) => {
    const s = base.split("").reduce((acc, n, i) => acc + Number(n) * pesos[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  return calc(d.slice(0, 12), p1) === Number(d[12]) && calc(d.slice(0, 13), p2) === Number(d[13]);
}

// Palavras de ligação que ficam em minúsculo no meio de um nome próprio —
// "João da Silva", "Comércio de Peças", "Rua das Flores".
const preposicoes = new Set([
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "em",
  "na",
  "no",
  "nas",
  "nas",
  "nos",
  "a",
  "o",
  "as",
  "os",
  "com",
  "para",
  "por",
  "sob",
  "ao",
  "aos",
  "à",
  "às",
  "sem",
]);

// Siglas das 27 unidades federativas — nunca sofrem Title Case.
const UFS_VALIDAS = new Set([
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
]);

// Siglas que devem permanecer em caixa alta mesmo dentro de um nome próprio.
const SIGLAS_CONHECIDAS = new Set([
  "ltda",
  "me",
  "epp",
  "eireli",
  "s/a",
  "sa",
  "cpf",
  "cnpj",
  "rg",
]);

/**
 * Title Case pt-BR: derruba tudo para minúsculo e sobe só a inicial de cada
 * palavra, mantendo preposições e artigos em minúsculo. Usado em nome próprio,
 * razão social, cidade, bairro, endereço e objeto social.
 *
 * A primeira palavra sempre sobe, mesmo sendo preposição. Tokens com dígito
 * passam intactos (CEP, "nº 100", "Sala 2A").
 */
export function tituloPtBr(texto: string): string {
  if (!texto) return texto;
  return (
    texto
      // "&" também separa: sem isso "P&G" vira um token só e sai "P&g".
      .split(/(\s+|[,/–\-&])/g)
      .map((parte, idx) => {
        if (/^\s+$/.test(parte) || /^[,/–\-&]$/.test(parte)) return parte;
        // numeros/CEP preservam
        if (/\d/.test(parte)) return parte;
        // Sigla de estado ("SC", "SP") continua em caixa alta — "Sc" no
        // contrato, ainda mais na cláusula de foro, é erro visível.
        if (UFS_VALIDAS.has(parte.toUpperCase())) return parte.toUpperCase();
        const min = parte.toLowerCase();
        if (SIGLAS_CONHECIDAS.has(min)) return min.toUpperCase();
        // primeira palavra sempre maiúscula
        if (idx === 0) return min.charAt(0).toUpperCase() + min.slice(1);
        if (preposicoes.has(min)) return min;
        // Letra sozinha sobe também: é inicial de nome ("João P. Silva") ou
        // parte de razão social ("Comercial X Ltda"). Artigos de uma letra já
        // foram tratados acima pela lista de preposições.
        return min.charAt(0).toUpperCase() + min.slice(1);
      })
      .join("")
  );
}

/** @deprecated Nome antigo de `tituloPtBr`, mantido para não quebrar chamadas. */
export const tituloEnderecoObjeto = tituloPtBr;

/**
 * Siglas de órgão expedidor e afins: "detran/sc" → "DETRAN/SC". Title Case
 * estragaria esses valores ("Detran/Sc").
 */
export function formatarSigla(valor: string): string {
  return valor
    .trim()
    .toLocaleUpperCase("pt-BR")
    .replace(/\s*\/\s*/g, "/");
}

// Detecta tipo de campo pelo nome do placeholder
export function detectarTipo(nome: string): string {
  const n = nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_\s]+/g, " ");
  // Endereço COMPOSTO vem antes de tudo: nomes como
  // "ENDERECO_COMPLETO_COM_RUA_NUMERO_BAIRRO_CEP" citam vários componentes e
  // seriam capturados pela regra de "cep" abaixo, quebrando a formatação e
  // reprovando o campo na validação de CEP da tela de revisão.
  if (/(endere|logradouro)/.test(n) && /(completo|\brua\b|numero|\bn\b|bairro|\bcep\b)/.test(n)) {
    return ehEnderecoDeEmpresa(n) ? "enderecoEmpresa" : "enderecoSocio";
  }
  if (/(cnpj)/.test(n)) return "cnpj";
  if (/\bcpf\b/.test(n)) return "cpf";
  if (/\bcep\b/.test(n)) return "cep";
  if (/(telefone|celular|fone)/.test(n)) return "telefone";
  if (/(capital social|valor.*quota|valor.*cota)/.test(n) && !/extenso/.test(n)) return "moeda";
  if (/(data.*nascimento|data.*fundac|^data$)/.test(n)) return "data";
  // "DATA ATUAL", "DATA DE HOJE", "DATA DE EMISSÃO"… — preenchidos com a data de
  // hoje; precisam do tipo "data" para manter dd/mm/aaaa ao reformatar.
  if (/\bdata\b.*\b(atual|hoje|do dia|corrente|emiss|gera)/.test(n)) return "data";
  if (/^\s*(n\.?º?|numero|número)\s*$/.test(n)) return "numero";
  if (/^\s*bairro\s*$/.test(n)) return "bairro";
  if (/^\s*(cidade|municipio)\s*$/.test(n)) return "cidade";
  if (/^\s*(uf|estado)\s*$/.test(n)) return "uf";
  if (/\b(cidade|municipio|bairro)\b/.test(n)) return "tituloSimples";
  if (/(endere|logradouro)/.test(n)) {
    return ehEnderecoDeEmpresa(n) ? "enderecoEmpresa" : "enderecoSocio";
  }
  if (/(objeto social|atividade)/.test(n)) return "objeto";
  if (/(extenso)/.test(n)) return "texto";
  // Órgão expedidor é sigla ("DETRAN/SC"); Title Case estragaria.
  if (/(orgao|órgão) *(expedidor|emissor)|\bssp\b|\bdetran\b/.test(n)) return "sigla";
  // Nome próprio / denominação — recebem Title Case na tela. Razão social e
  // sócio ainda saem em CAIXA ALTA no documento (ver ehCampoEmpresaOuSocio).
  if (
    /\b(razao social|nome empresarial|denominacao social|nome fantasia)\b/.test(n) ||
    /\bsocio\b|\bsocia\b|\badministrador\b|\badministradora\b/.test(n) ||
    /\b(nacionalidade|profissao|porte)\b/.test(n)
  ) {
    return "nomeProprio";
  }
  return "texto";
}

function ehEnderecoDeEmpresa(nomeNormalizado: string): boolean {
  return /(empresa|sede|estabelecim|matriz|filial)/.test(nomeNormalizado);
}

// Remove rótulos redundantes que a IA às vezes inclui no valor
// (ex.: "Bairro Colonial" para o campo Bairro → "Colonial", ou "Cep Cep 89..." → "89...").
function removerRotuloRedundante(valor: string, rotulo: RegExp): string {
  let v = valor.trim();
  for (let i = 0; i < 4; i++) {
    const novo = v
      .replace(rotulo, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[,:\-–]\s*/, "");
    if (novo === v) break;
    v = novo;
  }
  return v;
}

// Remove palavras consecutivas duplicadas ignorando caixa/acento.
// Ex.: "bairro Bairro Colonial" → "bairro Colonial"
//      "Cep CEP 89.288-645"     → "Cep 89.288-645"
//      "Rua rua das Flores"     → "Rua das Flores"
//      "Nº nº 380"              → "Nº 380"
// Preserva a primeira ocorrência (que normalmente é o rótulo minúsculo do modelo).
export function removerPalavrasDuplicadas(valor: string): string {
  if (!valor) return valor;
  const norm = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  let anterior = "";
  let atual = valor;
  // Loop até estabilizar (cobre 3+ repetições).
  while (anterior !== atual) {
    anterior = atual;
    atual = atual.replace(/(\b[\wÀ-ÿº°]+\b)(\s+)(\b[\wÀ-ÿº°]+\b)/g, (m, a, sp, b) =>
      norm(a) === norm(b) ? `${a}${sp}` : m,
    );
    atual = atual.replace(/\s{2,}/g, " ").trim();
  }
  return atual;
}

export function aplicarFormatacao(valor: string, tipo: string): string {
  if (!valor) return valor;
  const resultado = ((): string => {
    switch (tipo) {
      case "cpf":
        return formatarCPF(valor);
      case "cnpj":
        return formatarCNPJ(valor);
      case "cep": {
        const limpo = removerRotuloRedundante(valor, /\bcep\b[:\s]*/gi);
        return formatarCEP(limpo);
      }
      case "telefone":
        return formatarTelefone(valor);
      case "moeda":
        return formatarMoeda(valor);
      case "data":
        return formatarData(valor);
      case "numero": {
        const limpo = removerRotuloRedundante(valor, /\b(n\.?º?|nº|numero|número)\b[:\s]*/gi);
        const d = limpo.match(/\d+[A-Za-z]?/);
        return d ? d[0] : limpo;
      }
      case "bairro": {
        const limpo = removerRotuloRedundante(valor, /\bbairro\b[:\s]*/gi);
        return tituloEnderecoObjeto(limpo);
      }
      case "cidade": {
        const limpo = removerRotuloRedundante(valor, /\b(cidade|munic[ií]pio)\b[:\s]*/gi);
        return tituloEnderecoObjeto(limpo);
      }
      case "uf": {
        const limpo = removerRotuloRedundante(valor, /\b(uf|estado)\b[:\s]*/gi).trim();
        const uf = nomeEstadoParaUF(limpo);
        return uf || limpo.toUpperCase().slice(0, 2);
      }
      case "enderecoEmpresa":
        return formatarEnderecoEmpresa(valor);
      case "enderecoSocio":
      case "endereco":
        return formatarEnderecoSocio(valor);
      case "tituloSimples":
      case "objeto":
      case "nomeProprio":
        return tituloPtBr(valor);
      case "sigla":
        return formatarSigla(valor);
      default:
        return valor;
    }
  })();
  // Passe final: remover palavras consecutivas duplicadas em QUALQUER campo textual.
  // Não aplicar em campos puramente numéricos/formatados (cpf/cnpj/cep/telefone/moeda/data/numero/uf).
  const puramenteFormatados = new Set([
    "cpf",
    "cnpj",
    "cep",
    "telefone",
    "moeda",
    "data",
    "numero",
    "uf",
    "sigla",
  ]);
  if (puramenteFormatados.has(tipo)) return resultado;
  return removerPalavrasDuplicadas(resultado);
}

// Endereço do sócio: Title Case + CEP normalizado, mantendo padrão
// "rua Nome nº 123, bairro Nome, CEP 00.000-000" (tipos de logradouro em minúsculo).
export function formatarEnderecoSocio(raw: string): string {
  if (!raw) return raw;
  let s = removerPalavrasDuplicadas(raw.replace(/\s+/g, " ").trim());
  s = s.replace(/\b(\d{2})\.?(\d{3})-?(\d{3})\b/g, "$1.$2-$3");
  let t = tituloEnderecoObjeto(s);
  t = t
    .replace(/\bRua\b/g, "rua")
    .replace(/\bAvenida\b/g, "avenida")
    .replace(/\bTravessa\b/g, "travessa")
    .replace(/\bEstrada\b/g, "estrada")
    .replace(/\bRodovia\b/g, "rodovia")
    .replace(/\bAlameda\b/g, "alameda")
    .replace(/\bNº\b/g, "nº")
    .replace(/\bCep\b/g, "CEP")
    .replace(/\bBairro\b/g, "bairro");
  return t.replace(/^(.)/, (c) => c.toUpperCase());
}

// ===== Números por extenso (pt-BR) =====
const UNIDADES = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove"];
const DEZ_A_DEZENOVE = [
  "dez",
  "onze",
  "doze",
  "treze",
  "quatorze",
  "quinze",
  "dezesseis",
  "dezessete",
  "dezoito",
  "dezenove",
];
const DEZENAS = [
  "",
  "",
  "vinte",
  "trinta",
  "quarenta",
  "cinquenta",
  "sessenta",
  "setenta",
  "oitenta",
  "noventa",
];
const CENTENAS = [
  "",
  "cento",
  "duzentos",
  "trezentos",
  "quatrocentos",
  "quinhentos",
  "seiscentos",
  "setecentos",
  "oitocentos",
  "novecentos",
];

function ateNovecentos(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c > 0) partes.push(CENTENAS[c]);
  if (resto > 0) {
    if (resto < 10) partes.push(UNIDADES[resto]);
    else if (resto < 20) partes.push(DEZ_A_DEZENOVE[resto - 10]);
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u > 0 ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
    }
  }
  return partes.join(" e ");
}

export function inteiroPorExtenso(num: number): string {
  if (!Number.isFinite(num)) return "";
  const n = Math.trunc(Math.abs(num));
  if (n === 0) return "zero";
  const bilhoes = Math.floor(n / 1_000_000_000);
  const milhoes = Math.floor((n % 1_000_000_000) / 1_000_000);
  const milhares = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const partes: string[] = [];
  if (bilhoes > 0)
    partes.push(`${bilhoes === 1 ? "um bilhão" : `${ateNovecentos(bilhoes)} bilhões`}`);
  if (milhoes > 0)
    partes.push(`${milhoes === 1 ? "um milhão" : `${ateNovecentos(milhoes)} milhões`}`);
  if (milhares > 0) partes.push(milhares === 1 ? "mil" : `${ateNovecentos(milhares)} mil`);
  if (resto > 0) partes.push(ateNovecentos(resto));
  // Conector "e" antes da última parte se for < 100 ou múltiplo de 100
  let texto = "";
  partes.forEach((p, i) => {
    if (i === 0) texto = p;
    else {
      const isUltimo = i === partes.length - 1;
      texto += isUltimo ? `, ${p}` : `, ${p}`;
    }
  });
  return texto;
}

export function moedaPorExtenso(valor: number | string): string {
  const n =
    typeof valor === "number"
      ? valor
      : Number(
          String(valor)
            .replace(/[^\d,.-]/g, "")
            .replace(/\./g, "")
            .replace(",", "."),
        );
  if (!Number.isFinite(n)) return "";
  const reais = Math.trunc(n);
  const centavos = Math.round((n - reais) * 100);
  const partes: string[] = [];
  if (reais > 0) partes.push(`${inteiroPorExtenso(reais)} ${reais === 1 ? "real" : "reais"}`);
  if (centavos > 0)
    partes.push(`${inteiroPorExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  if (partes.length === 0) return "zero real";
  const texto = partes.join(" e ");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function quotasPorExtenso(valor: number | string): string {
  const n = typeof valor === "number" ? valor : Number(String(valor).replace(/\D/g, ""));
  if (!Number.isFinite(n) || n <= 0) return "";
  const texto = `${inteiroPorExtenso(n)} ${n === 1 ? "quota" : "quotas"}`;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// ===== Endereço da empresa =====
const ESTADOS_BR: Record<string, string> = {
  acre: "AC",
  alagoas: "AL",
  amapa: "AP",
  amazonas: "AM",
  bahia: "BA",
  ceara: "CE",
  "distrito federal": "DF",
  "espirito santo": "ES",
  goias: "GO",
  maranhao: "MA",
  "mato grosso": "MT",
  "mato grosso do sul": "MS",
  "minas gerais": "MG",
  para: "PA",
  paraiba: "PB",
  parana: "PR",
  pernambuco: "PE",
  piaui: "PI",
  "rio de janeiro": "RJ",
  "rio grande do norte": "RN",
  "rio grande do sul": "RS",
  rondonia: "RO",
  roraima: "RR",
  "santa catarina": "SC",
  "sao paulo": "SP",
  sergipe: "SE",
  tocantins: "TO",
};

function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function nomeEstadoParaUF(texto: string): string {
  const n = normalizar(texto);
  if (/^[a-z]{2}$/.test(n) && Object.values(ESTADOS_BR).includes(n.toUpperCase())) {
    return n.toUpperCase();
  }
  return ESTADOS_BR[n] ?? "";
}

/**
 * Quebra uma linha de endereço nas suas peças. Usado como rede de segurança
 * quando a IA devolve o endereço inteiro em vez dos componentes separados.
 */
export function decomporEndereco(raw: string): ComponentesEndereco {
  if (!raw) return { ...ENDERECO_VAZIO };
  let s = removerPalavrasDuplicadas(raw.replace(/\s+/g, " ").trim());

  // Extrair CEP (8 dígitos, formatado ou não) junto com o rótulo "CEP" que
  // costuma vir antes dele — sem isso a palavra sobra e polui a cidade.
  let cep = "";
  const cepMatch = s.match(/(\bcep\b[:\s]*)?\b\d{2}\.?\d{3}-?\d{3}\b/i);
  if (cepMatch) {
    const d = cepMatch[0].replace(/\D/g, "");
    if (d.length === 8) {
      cep = `${d.slice(0, 2)}.${d.slice(2, 5)}-${d.slice(5)}`;
      s = (s.slice(0, cepMatch.index!) + s.slice(cepMatch.index! + cepMatch[0].length)).trim();
    }
  }
  // Limpar separadores residuais
  s = s.replace(/[-–,]\s*$/g, "").trim();

  // Quebrar por "-", "–" ou ","
  let partes = s
    .split(/\s*[-–,]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Número e complemento costumam vir como partes próprias — é o formato que o
  // próprio prompt manda a IA usar ("Rua X, nº 100, sala 2, bairro Y").
  // Sem retirá-los aqui, "nº 100" acabaria virando bairro.
  // Rótulos escritos na própria linha ("bairro Centro", "Município X") não são
  // dado — são etiqueta. Removê-los evita "bairro Bairro Centro" na remontagem.
  partes = partes.map((p) =>
    p.replace(/^(bairro|b\.|munic[ií]pio|cidade|logradouro|endere[çc]o)\b[:\s]*/i, "").trim(),
  );

  let numeroSolto = "";
  let complemento = "";
  partes = partes.filter((parte) => {
    const soNumero = parte.match(/^(?:n\.?º?|nº|numero|número)?\s*(\d+[A-Za-z]?)$/i);
    if (soNumero && !numeroSolto) {
      numeroSolto = soNumero[1];
      return false;
    }
    if (/^(sala|apto|apartamento|bloco|casa|loja|conjunto|andar|fundos|sobrado)\b/i.test(parte)) {
      complemento = complemento ? `${complemento}, ${parte}` : parte;
      return false;
    }
    return true;
  });

  // Detectar UF na última parte
  let uf = "";
  if (partes.length > 0) {
    const ultima = partes[partes.length - 1];
    const ufDetectada = nomeEstadoParaUF(ultima);
    if (ufDetectada) {
      uf = ufDetectada;
      partes.pop();
    } else {
      // tentar últimas duas palavras (ex: "rio grande do sul")
      const tokens = ultima.split(/\s+/);
      for (let n = Math.min(4, tokens.length); n >= 2; n--) {
        const cand = tokens.slice(-n).join(" ");
        const ufd = nomeEstadoParaUF(cand);
        if (ufd) {
          uf = ufd;
          const resto = tokens
            .slice(0, tokens.length - n)
            .join(" ")
            .trim();
          if (resto) partes[partes.length - 1] = resto;
          else partes.pop();
          break;
        }
      }
    }
  }

  // Primeira parte: logradouro + número
  let logradouro = "";
  let numero = "";
  if (partes.length > 0) {
    const first = partes.shift()!;
    const m = first.match(/^(.+?)[\s,]+(?:nº\s*|n\.?º?\s*|numero\s*)?(\d+[A-Za-z]?)\s*$/i);
    if (m) {
      logradouro = m[1].trim();
      numero = m[2];
    } else {
      logradouro = first;
    }
  }

  // Restante: bairro + cidade
  let bairro = "";
  let cidade = "";
  if (partes.length >= 2) {
    bairro = partes[0];
    cidade = partes.slice(1).join(" ");
  } else if (partes.length === 1) {
    const tokens = partes[0].split(/\s+/);
    if (tokens.length >= 3) {
      // primeira palavra = bairro, resto = cidade (heurística comum em endereços abreviados)
      bairro = tokens[0];
      cidade = tokens.slice(1).join(" ");
    } else {
      cidade = partes[0];
    }
  }

  return { logradouro, numero: numero || numeroSolto, complemento, bairro, cidade, uf, cep };
}

export function formatarEnderecoEmpresa(raw: string): string {
  return montarEnderecoEmpresa(decomporEndereco(raw));
}

// ===== Endereço em componentes =====
// A tela de revisão trabalha peça a peça (dá para validar cada uma); o contrato
// recebe a linha montada. `decomporEndereco` é o caminho de volta, usado quando
// a IA devolve só a linha inteira.

export type ComponentesEndereco = {
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
};

export const ENDERECO_VAZIO: ComponentesEndereco = {
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  uf: "",
  cep: "",
};

/** CEP no formato usado dentro de endereço: 00.000-000 */
function cepComPonto(valor: string): string {
  const d = valor.replace(/\D/g, "");
  if (d.length !== 8) return valor.trim();
  return `${d.slice(0, 2)}.${d.slice(2, 5)}-${d.slice(5)}`;
}

/**
 * Endereço do SÓCIO: "rua X nº 100, sala 2, Bairro Y, CEP 00.000-000".
 * Sem município nem UF — no contrato eles vêm de campos próprios.
 * Tipo de logradouro em minúsculo, "Bairro" com maiúscula, "CEP" em caixa alta.
 */
export function montarEnderecoSocio(c: Partial<ComponentesEndereco>): string {
  const partes: string[] = [];
  if (c.logradouro) {
    const via = minusculizarTipoLogradouro(tituloPtBr(c.logradouro));
    partes.push(c.numero ? `${via} nº ${c.numero}` : via);
  }
  if (c.complemento) partes.push(tituloPtBr(c.complemento));
  if (c.bairro) partes.push(`Bairro ${tituloPtBr(c.bairro)}`);
  if (c.cep) partes.push(`CEP ${cepComPonto(c.cep)}`);
  return partes.join(", ");
}

/**
 * Endereço da EMPRESA: "Rua X, nº 100, bairro Y, Município - UF, CEP 00.000-000".
 * Aqui o logradouro fica capitalizado e "bairro" em minúsculo — é o padrão que o
 * modelo de contrato usa na cláusula da sede.
 */
export function montarEnderecoEmpresa(c: Partial<ComponentesEndereco>): string {
  const partes: string[] = [];
  if (c.logradouro) {
    const via = tituloPtBr(c.logradouro);
    partes.push(c.numero ? `${via}, nº ${c.numero}` : via);
  }
  if (c.complemento) partes.push(tituloPtBr(c.complemento));
  if (c.bairro) partes.push(`bairro ${tituloPtBr(c.bairro)}`);
  if (c.cidade) partes.push(c.uf ? `${tituloPtBr(c.cidade)} - ${c.uf}` : tituloPtBr(c.cidade));
  else if (c.uf) partes.push(c.uf);
  let resultado = partes.join(", ");
  if (c.cep) resultado += `${resultado ? ", " : ""}CEP ${cepComPonto(c.cep)}`;
  return resultado.trim();
}

function minusculizarTipoLogradouro(texto: string): string {
  return texto.replace(
    /^(Rua|Avenida|Travessa|Estrada|Rodovia|Alameda|Praça|Servidão|Linha)\b/,
    (m) => m.toLowerCase(),
  );
}

/** `true` se ao menos uma peça do endereço está preenchida. */
export function temAlgumComponente(c: Partial<ComponentesEndereco>): boolean {
  return Object.values(c).some((v) => (v ?? "").trim().length > 0);
}
