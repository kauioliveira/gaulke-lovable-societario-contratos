// Validação estrutural do modelo de contrato, executada no momento do upload.
//
// Objetivo: pegar problemas que só apareceriam tarde demais — no contrato final
// (campo não preenchido, texto duplicado) ou como retrabalho na tela de revisão
// (o mesmo dado pedido duas vezes). Erros bloqueiam e o arquivo é descartado;
// avisos apenas informam.
//
// Função pura sobre a estrutura devolvida por `extrairPlaceholders` — não
// depende de pizzip, então roda no cliente.

export type EstruturaModelo = {
  placeholders: string[];
  /** Trechos com chaves quebradas, ex.: `{{CAMPO}`, `{CAMPO}` */
  malformados: string[];
  /**
   * O `.docx` convertido, quando a origem era `.doc`. Vazio caso contrário — o
   * cliente já tem o arquivo original e devolvê-lo dobraria o tráfego à toa.
   */
  templateBase64: string;
  convertidoDeDoc: boolean;
};

export type Diagnostico = {
  codigo: string;
  titulo: string;
  detalhe: string;
  /** Trechos/campos concretos do modelo que motivaram o diagnóstico */
  itens?: string[];
};

export type ResultadoDiagnostico = {
  erros: Diagnostico[];
  avisos: Diagnostico[];
};

const PREFIXO_VERMELHO = "__VERMELHO__::";

export function nomeDoCampo(chave: string): string {
  return (chave.startsWith(PREFIXO_VERMELHO) ? chave.slice(PREFIXO_VERMELHO.length) : chave).trim();
}

/** Mesma normalização de `detectarTipo`: sem acento, minúsculo, `_`/espaços colapsados. */
function normalizar(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_\s]+/g, " ")
    .trim();
}

// Placeholders cujo texto é só o rótulo do campo — o modelo normalmente já
// imprime esse rótulo antes do marcador, então só o dado puro é inserido.
const ROTULOS = new Set([
  "bairro",
  "cep",
  "n",
  "no",
  "numero",
  "rua",
  "logradouro",
  "cidade",
  "municipio",
  "uf",
  "estado",
  "endereco",
  "razao social",
  "nome empresarial",
  "nome fantasia",
]);

/**
 * Agrupa as chaves que se referem ao mesmo campo, diferindo só por acento,
 * caixa, `_` vs. espaço — `SOCIO` e `SÓCIO`, `CIDADE_E_ESTADO` e
 * `CIDADE E ESTADO`.
 *
 * Usado para detectar `grafias-divergentes` (erro que bloqueia o upload) e,
 * na tela de revisão, para renderizar um card por campo. Como o upload já
 * barra grafias duplicadas, na prática todo grupo tem um único elemento — a
 * lógica de agrupamento fica como rede de segurança, garantindo que grafias
 * equivalentes nunca recebam valores diferentes caso alguma escape.
 *
 * Preserva a ordem original dos placeholders: o primeiro de cada grupo é o
 * representante exibido na tela.
 */
export function agruparGrafiasEquivalentes(placeholders: string[]): string[][] {
  const grupos = new Map<string, string[]>();
  for (const p of placeholders) {
    const chave = normalizar(nomeDoCampo(p)) || p;
    grupos.set(chave, [...(grupos.get(chave) ?? []), p]);
  }
  return [...grupos.values()];
}

export function diagnosticarModelo(estrutura: EstruturaModelo): ResultadoDiagnostico {
  const erros: Diagnostico[] = [];
  const avisos: Diagnostico[] = [];
  const { placeholders, malformados } = estrutura;

  // ----- ERROS -----

  if (placeholders.length === 0) {
    erros.push({
      codigo: "sem-campos",
      titulo: "Nenhum campo variável encontrado",
      detalhe:
        "Marque os campos do modelo como {{NOME_DO_CAMPO}} ou deixe o texto em vermelho. " +
        "Sem marcação não há o que preencher.",
    });
  }

  // `{{}}` chega aqui como "malformado" porque não casa com a regex de tag
  // válida (que exige ao menos um caractere), mas o problema é outro: falta o
  // nome do campo. Separar melhora a instrução dada ao usuário.
  const semNome = malformados.filter((t) => /^\{\{\s*\}\}$/.test(t));
  const chavesQuebradas = malformados.filter((t) => !semNome.includes(t));

  if (chavesQuebradas.length > 0) {
    erros.push({
      codigo: "chave-malformada",
      titulo: "Marcador com chaves incompletas",
      detalhe:
        "Estes trechos têm chaves faltando ou sobrando e não seriam preenchidos — sairiam " +
        "literalmente no contrato final. Use exatamente duas chaves de cada lado: {{CAMPO}}.",
      itens: chavesQuebradas,
    });
  }

  if (semNome.length > 0) {
    erros.push({
      codigo: "campo-sem-nome",
      titulo: "Marcador sem nome de campo",
      detalhe:
        "Há marcadores vazios no modelo. Escreva o nome do campo entre as chaves, " +
        "por exemplo {{RAZAO_SOCIAL}}.",
      itens: semNome,
    });
  }

  // Mesmo campo escrito de formas diferentes (acento, underscore vs. espaço,
  // caixa). Bloqueia: cada campo precisa de um nome canônico único no modelo,
  // senão qualquer busca futura por nome de campo (auditoria, varredura em
  // lote, mapeamento fixo) encontra grafias concorrentes e falha.
  const divergentes = agruparGrafiasEquivalentes(placeholders)
    .map((chaves) => [...new Set(chaves.map(nomeDoCampo))])
    .filter((grafias) => grafias.length > 1);
  if (divergentes.length > 0) {
    erros.push({
      codigo: "grafias-divergentes",
      titulo: "Mesmo campo escrito de formas diferentes",
      detalhe:
        "Cada grafia é um marcador distinto no Word e o mesmo campo acaba com dois nomes. " +
        "Escolha uma grafia e use só ela em todo o documento — atenção a acento, maiúsculas e " +
        "underscore vs. espaço.",
      itens: divergentes.map((grafias) => grafias.join("  ≠  ")),
    });
  }

  // ----- AVISOS -----

  // Sem `^\s|\s$`: os nomes já chegam aparados de `extrairPlaceholders`.
  const espacamento = placeholders.map(nomeDoCampo).filter((n) => /_\s|\s_|\s{2,}/.test(n));
  if (espacamento.length > 0) {
    avisos.push({
      codigo: "espacamento-irregular",
      titulo: "Espaços irregulares no nome do campo",
      detalhe:
        "Funciona, mas o nome aparece torto na tela de revisão e dificulta o reconhecimento " +
        "automático do tipo do campo.",
      itens: espacamento,
    });
  }

  const rotulos = placeholders
    .filter((p) => p.startsWith(PREFIXO_VERMELHO))
    .map(nomeDoCampo)
    .filter((n) => ROTULOS.has(normalizar(n)));
  if (rotulos.length > 0) {
    avisos.push({
      codigo: "placeholder-rotulo",
      titulo: "Campos em vermelho que são apenas rótulos",
      detalhe:
        "Serão preenchidos só com o dado puro (sem repetir o rótulo), assumindo que o modelo " +
        "já imprime o rótulo antes do marcador. Confira o resultado na pré-visualização.",
      itens: rotulos,
    });
  }

  return { erros, avisos };
}
