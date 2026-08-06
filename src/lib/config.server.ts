// Ponto único de leitura de variáveis de ambiente. Nada de `process.env`
// espalhado pelo código: aqui é onde se descobre o que o app precisa para rodar.

export type ConfigOpenAI = {
  apiKey: string;
  modelo: string;
  baseUrl: string;
  timeoutMs: number;
};

const MODELO_PADRAO = "gpt-5.4";
const BASE_URL_PADRAO = "https://api.openai.com/v1";
const TIMEOUT_PADRAO_MS = 120_000;

export const MENSAGEM_SEM_CHAVE =
  "OPENAI_API_KEY não configurada. Preencha a chave da OpenAI no arquivo .env " +
  "e reinicie o servidor.";

function texto(nome: string): string {
  return (process.env[nome] ?? "").trim();
}

/** `true` se há chave da OpenAI configurada. Não expõe o valor. */
export function iaConfigurada(): boolean {
  return texto("OPENAI_API_KEY").length > 0;
}

/** Nome do modelo em uso — seguro para mostrar na interface. */
export function modeloEmUso(): string {
  return texto("OPENAI_MODEL") || MODELO_PADRAO;
}

export function obterConfigOpenAI(): ConfigOpenAI {
  const apiKey = texto("OPENAI_API_KEY");
  if (!apiKey) throw new Error(MENSAGEM_SEM_CHAVE);

  const timeoutBruto = Number(texto("OPENAI_TIMEOUT_MS"));
  return {
    apiKey,
    modelo: modeloEmUso(),
    // Sem barra no fim, para concatenar caminhos sem duplicar "/".
    baseUrl: (texto("OPENAI_BASE_URL") || BASE_URL_PADRAO).replace(/\/+$/, ""),
    timeoutMs: Number.isFinite(timeoutBruto) && timeoutBruto > 0 ? timeoutBruto : TIMEOUT_PADRAO_MS,
  };
}
