import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// ---------- Schemas ----------

const ArquivoSchema = z.object({
  nome: z.string(),
  mime: z.string(),
  base64: z.string(),
});

const AnalisarSchema = z.object({
  templateBase64: z.string(),
});

const ExtrairSchema = z.object({
  placeholders: z.array(z.string()).min(1),
  arquivos: z.array(ArquivoSchema).min(1),
});

const GerarSchema = z.object({
  templateBase64: z.string(),
  valores: z.record(z.string(), z.string()),
});

// ---------- Status da configuração ----------
// Consultada no carregamento da página. Devolve só o que a interface precisa
// saber para decidir se dá para trabalhar — nunca a chave em si.

export const obterStatusConfiguracao = createServerFn({ method: "GET" }).handler(async () => {
  const { iaConfigurada, modeloEmUso } = await import("./config.server");
  const { conversaoDisponivel } = await import("./conversao-doc.server");

  return {
    iaConfigurada: iaConfigurada(),
    conversaoDocDisponivel: await conversaoDisponivel(),
    modelo: modeloEmUso(),
  };
});

// ---------- Análise do modelo: descobrir placeholders ----------

export const analisarModelo = createServerFn({ method: "POST" })
  .validator((data: unknown) => AnalisarSchema.parse(data))
  .handler(async ({ data }) => {
    const { extrairPlaceholders } = await import("./contratos.server");
    return await extrairPlaceholders(data.templateBase64);
  });

// ---------- Extração com IA ----------

export const extrairDados = createServerFn({ method: "POST" })
  .validator((data: unknown) => ExtrairSchema.parse(data))
  .handler(async ({ data }) => {
    const { extrairValoresViaIA } = await import("./contratos.server");
    return await extrairValoresViaIA(data.placeholders, data.arquivos);
  });

// ---------- Geração do .docx final ----------

export const gerarContrato = createServerFn({ method: "POST" })
  .validator((data: unknown) => GerarSchema.parse(data))
  .handler(async ({ data }) => {
    const { gerarDocxPreenchido } = await import("./contratos.server");
    const docxBase64 = await gerarDocxPreenchido(data.templateBase64, data.valores);
    return { docxBase64 };
  });
