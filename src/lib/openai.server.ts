// Cliente HTTP mínimo para a API da OpenAI.
//
// Não usamos o SDK oficial nem o AI SDK da Vercel: o que precisamos é uma única
// chamada a /chat/completions com conteúdo multimodal (PDF + imagem) e resposta
// em JSON estrito. Um `fetch` resolve, sem arrastar dependência nem esbarrar em
// adaptadores que não suportam file parts de PDF.

import { obterConfigOpenAI } from "./config.server";

export type ParteConteudo = Record<string, unknown>;

export type EsquemaJson = {
  nome: string;
  schema: Record<string, unknown>;
};

type RespostaChat = {
  choices?: Array<{
    message?: { content?: string; refusal?: string | null };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

const TENTATIVAS = 2;
const ESPERA_ENTRE_TENTATIVAS_MS = 2_000;

/**
 * Faz a chamada de extração e devolve o texto da resposta (JSON) já validado
 * contra o esquema, mais o consumo de tokens.
 *
 * Structured Outputs é o caminho principal. Se a API recusar a combinação de
 * `response_format` com entrada de arquivo, repetimos sem ele — o prompt já
 * descreve o JSON esperado, então o caminho antigo continua funcionando.
 */
export async function completarComEsquema(
  promptSistema: string,
  conteudoUsuario: ParteConteudo[],
  esquema: EsquemaJson,
): Promise<{ texto: string; tokens: number; comEsquema: boolean }> {
  const config = obterConfigOpenAI();

  const corpoBase = {
    model: config.modelo,
    temperature: 0.1,
    messages: [
      { role: "system", content: promptSistema },
      { role: "user", content: conteudoUsuario },
    ],
  };

  const responseFormat = {
    type: "json_schema",
    json_schema: { name: esquema.nome, strict: true, schema: esquema.schema },
  };

  try {
    const r = await postar(config, { ...corpoBase, response_format: responseFormat });
    return { ...r, comEsquema: true };
  } catch (e) {
    if (!(e instanceof ErroResponseFormat)) throw e;
    console.warn(
      "A API recusou response_format json_schema; repetindo sem esquema estrito.",
      e.detalhe,
    );
    const r = await postar(config, corpoBase);
    return { ...r, comEsquema: false };
  }
}

/** Erro específico para "o modelo/endpoint não aceita response_format aqui". */
class ErroResponseFormat extends Error {
  constructor(public detalhe: string) {
    super("response_format não suportado");
  }
}

async function postar(
  config: ReturnType<typeof obterConfigOpenAI>,
  corpo: Record<string, unknown>,
): Promise<{ texto: string; tokens: number }> {
  let ultimoErro: Error | undefined;

  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    let resposta: Response;
    try {
      resposta = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(corpo),
        // Sem isto uma requisição travada trava a tela do usuário para sempre.
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (e) {
      if ((e as Error).name === "TimeoutError" || (e as Error).name === "AbortError") {
        throw new Error(
          `A IA não respondeu em ${Math.round(config.timeoutMs / 1000)}s. ` +
            "Tente com menos documentos ou aumente OPENAI_TIMEOUT_MS.",
        );
      }
      throw new Error(`Não foi possível falar com a OpenAI: ${(e as Error).message}`);
    }

    if (resposta.ok) {
      const json = (await resposta.json()) as RespostaChat;
      const escolha = json.choices?.[0];
      if (escolha?.message?.refusal) {
        throw new Error(`A IA recusou a solicitação: ${escolha.message.refusal}`);
      }
      if (escolha?.finish_reason === "length") {
        throw new Error(
          "A resposta da IA foi cortada por limite de tamanho. " +
            "Tente com menos campos ou menos documentos por vez.",
        );
      }
      return {
        texto: (escolha?.message?.content ?? "").trim(),
        tokens: json.usage?.total_tokens ?? 0,
      };
    }

    const detalhe = await resposta.text();

    // Recusa do response_format: não adianta repetir igual — sobe para o
    // chamador tentar sem esquema estrito.
    if (resposta.status === 400 && /response_format|json_schema/i.test(detalhe)) {
      throw new ErroResponseFormat(detalhe.slice(0, 300));
    }

    const erro = traduzirErro(resposta.status, detalhe);
    // 429 e 5xx costumam ser transitórios; o resto não melhora repetindo.
    const vaiMelhorarRepetindo =
      (resposta.status === 429 && !/insufficient_quota/i.test(detalhe)) || resposta.status >= 500;
    if (!vaiMelhorarRepetindo || tentativa === TENTATIVAS) throw erro;

    ultimoErro = erro;
    await new Promise((r) => setTimeout(r, ESPERA_ENTRE_TENTATIVAS_MS * tentativa));
  }

  throw ultimoErro ?? new Error("Falha desconhecida na chamada à OpenAI.");
}

function traduzirErro(status: number, detalhe: string): Error {
  if (status === 401 || status === 403) {
    return new Error(
      "Chave da OpenAI inválida ou sem permissão. Confira OPENAI_API_KEY no arquivo .env.",
    );
  }
  if (status === 404) {
    return new Error(
      "Modelo não encontrado na sua conta da OpenAI. Confira OPENAI_MODEL no arquivo .env.",
    );
  }
  if (status === 429) {
    if (/insufficient_quota|billing/i.test(detalhe)) {
      return new Error(
        "Créditos da OpenAI esgotados. Verifique o faturamento em platform.openai.com/settings/organization/billing.",
      );
    }
    return new Error(
      "Limite de requisições da OpenAI atingido. Aguarde alguns instantes e tente novamente.",
    );
  }
  if (status === 413) {
    return new Error(
      "Os documentos enviados são grandes demais para uma única requisição. " +
        "Envie menos arquivos por vez.",
    );
  }
  if (status === 400) {
    return new Error(`A OpenAI recusou a requisição: ${extrairMensagem(detalhe)}`);
  }
  if (status >= 500) {
    return new Error("A OpenAI está indisponível no momento. Tente novamente em instantes.");
  }
  return new Error(`Falha na chamada à IA (${status}): ${extrairMensagem(detalhe)}`);
}

function extrairMensagem(corpo: string): string {
  try {
    const j = JSON.parse(corpo) as { error?: { message?: string } };
    if (j.error?.message) return j.error.message.slice(0, 300);
  } catch {
    // corpo não era JSON — cai no texto cru
  }
  return corpo.slice(0, 300);
}
