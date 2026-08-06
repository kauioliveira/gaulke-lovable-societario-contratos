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

// ---------- Análise do modelo: descobrir placeholders ----------

export const analisarModelo = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => AnalisarSchema.parse(data))
  .handler(async ({ data }) => {
    const { extrairPlaceholders } = await import("./contratos.server");
    const placeholders = await extrairPlaceholders(data.templateBase64);
    return { placeholders };
  });

// ---------- Extração com IA ----------

export const extrairDados = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => ExtrairSchema.parse(data))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) {
      throw new Error(
        "LOVABLE_API_KEY não configurada. A integração com a IA não está disponível.",
      );
    }

    const { extrairValoresViaIA } = await import("./contratos.server");
    return await extrairValoresViaIA(key, data.placeholders, data.arquivos);
  });

// ---------- Geração do .docx final ----------

export const gerarContrato = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => GerarSchema.parse(data))
  .handler(async ({ data }) => {
    const { gerarDocxPreenchido } = await import("./contratos.server");
    const docxBase64 = await gerarDocxPreenchido(data.templateBase64, data.valores);
    return { docxBase64 };
  });
