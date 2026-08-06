# Rotas e API

## Roteamento

TanStack Start com **file-based routing**: cada `.tsx` em [src/routes/](src/routes/)
define uma rota. Convenções completas em [src/routes/README.md](src/routes/README.md).
`src/routeTree.gen.ts` é gerado automaticamente — não edite à mão.

## Rotas de página

| Arquivo                                          | URL        | Componente                    | Descrição                                                          |
| ------------------------------------------------ | ---------- | ----------------------------- | ------------------------------------------------------------------ |
| [src/routes/\_\_root.tsx](src/routes/__root.tsx) | —          | `RootShell` / `RootComponent` | Shell HTML, `QueryClientProvider`, `Toaster`, 404 e error boundary |
| [src/routes/index.tsx](src/routes/index.tsx)     | `/`        | `PaginaInicial`               | Upload do modelo e dos documentos; dispara análise + extração      |
| [src/routes/revisao.tsx](src/routes/revisao.tsx) | `/revisao` | `PaginaRevisao`               | Revisão dos dados extraídos, validações, prévia e download         |

Nenhuma rota tem `loader` ou parâmetros dinâmicos. Ambas definem `head()` com
título e metatags próprias.

### `/`

- Estado local: `modelo: ArquivoUpload[]` (máx. 1, `.docx`) e
  `docs: ArquivoUpload[]` (máx. 10, `.pdf/.jpg/.jpeg/.png/.webp`).
- Botão habilita apenas com exatamente 1 modelo e ≥ 1 documento.
- Ao concluir, grava em `sessionStorage["gaulke:contrato:estado"]`:

```ts
{
  template: { nome: string; base64: string };
  placeholders: string[];
  extracao: {
    valores: Record<string, { valor: string; fonte: string; confianca: "alta" | "media" | "baixa" }>;
    faltantes: string[];
    conflitos: { campo: string; valores: { valor: string; fonte: string }[] }[];
    observacoes: string;
  };
}
```

- Navega para `/revisao`.

### `/revisao`

- **Sem o estado em `sessionStorage`, redireciona para `/`.**
- Bloqueia a geração enquanto houver problemas de tipo `erro` (campo em branco,
  CPF/CNPJ inválido, regime de bens faltando para sócio casado). CEP fora do
  padrão é apenas `aviso`.
- Após gerar, abre um `Dialog` com a prévia HTML (mammoth) e o botão de download.

## Server functions

Definidas em [src/lib/contratos.functions.ts](src/lib/contratos.functions.ts) com
`createServerFn({ method: "POST" })` e validação Zod no `inputValidator`. São
chamadas diretamente do cliente como funções — não há rotas REST expostas.

Erros são lançados como `Error`; o cliente os exibe via `toast.error(e.message)`.

### `analisarModelo`

Detecta os campos variáveis do modelo Word.

```ts
// entrada
{ templateBase64: string }
// saída
{ placeholders: string[] }
```

Chaves retornadas em dois formatos:

- `NOME_DO_CAMPO` — veio de um `{{NOME_DO_CAMPO}}` no documento;
- `__VERMELHO__::<texto>` — veio de um run em vermelho, onde `<texto>` é o
  próprio conteúdo do trecho.

Retornar lista vazia faz a página inicial abortar com mensagem orientando sobre
as marcações aceitas.

### `extrairDados`

Extrai os valores dos documentos com IA multimodal.

```ts
// entrada
{
  placeholders: string[];                                   // min. 1
  arquivos: { nome: string; mime: string; base64: string }[]; // min. 1
}
// saída
{
  valores: Record<string, { valor: string; fonte: string; confianca: "alta" | "media" | "baixa" }>;
  faltantes: string[];
  conflitos: { campo: string; valores: { valor: string; fonte: string }[] }[];
  observacoes: string;
}
```

- Requer `process.env.LOVABLE_API_KEY`; sem ela, lança erro explicando que a
  integração não está disponível.
- Erros propagados do gateway: `429` → "Limite de uso da IA atingido…",
  `402` → "Créditos da IA esgotados…".
- Além dos placeholders solicitados, pode retornar o meta-campo
  `__META_TIPO_DOC_IDENTIDADE__` com `"RG"`, `"CNH"` ou `""`.
- Campos cujo nome indique "data atual/hoje/do dia/corrente/emissão/geração" são
  sempre preenchidos com a data de hoje em `America/Sao_Paulo`, ignorando o que
  a IA encontrou.

### `gerarContrato`

Produz o `.docx` preenchido.

```ts
// entrada
{
  templateBase64: string;
  valores: Record<string, string>; // chaves iguais às de analisarModelo, + __META_*
}
// saída
{
  docxBase64: string;
}
```

Placeholders sem valor voltam ao documento como `{{NOME}}` (via `nullGetter`) e
runs vermelhos sem valor permanecem vermelhos — os dois casos ficam visíveis no
arquivo final para conferência.

## Provedor externo

| Endpoint                                             | Método | Uso                                                                                                                                             |
| ---------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `https://ai.gateway.lovable.dev/v1/chat/completions` | `POST` | Extração multimodal, modelo `google/gemini-3-flash-preview`, `temperature: 0.1`. Headers: `Lovable-API-Key`, `X-Lovable-AIG-SDK: vercel-ai-sdk` |

Chamado por `fetch` direto em
[src/lib/contratos.server.ts](src/lib/contratos.server.ts) — o adapter
`@ai-sdk/openai-compatible` não suporta file parts de PDF.
