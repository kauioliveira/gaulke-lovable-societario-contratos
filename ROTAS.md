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

Nenhuma rota tem parâmetros dinâmicos. A rota **raiz** tem um `loader` que
consulta `obterStatusConfiguracao` (ver abaixo); as duas rotas de página não têm
loader e definem `head()` com título e metatags próprias.

### `/`

- Estado local: `modelo: ArquivoUpload[]` (máx. 1, `.docx`/`.doc`),
  `docs: ArquivoUpload[]` (máx. 10, `.pdf/.jpg/.jpeg/.png/.webp`),
  `diagnostico` e `placeholdersValidados`.
- **Ao trocar o modelo** (`aoTrocarModelo`), dispara a mutation `validacao`:
  checa o formato localmente, chama `analisarModelo` e roda
  `diagnosticarModelo()`. Havendo erros, `setModelo([])` descarta o arquivo,
  `placeholdersValidados` volta a `null` e um toast de erro é exibido.
- Botão habilita apenas com `placeholdersValidados !== null` e ≥ 1 documento —
  ou seja, um modelo que passou na validação.
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
`createServerFn` e validação Zod no `validator`. São chamadas diretamente do
cliente como funções — não há rotas REST expostas.

Erros são lançados como `Error`; o cliente os exibe via `toast.error(e.message)`.

### `obterStatusConfiguracao`

Chamada pelo `loader` da rota raiz, no carregamento da página.

```ts
// sem entrada
// saída
{
  iaConfigurada: boolean;
  conversaoDocDisponivel: boolean;
  modelo: string;
}
```

Devolve apenas o que a interface precisa para decidir se dá para trabalhar —
**nunca a chave**. Com `iaConfigurada: false` o `RootComponent` renderiza a tela
de configuração ausente no lugar do `<Outlet />`, e o aplicativo não abre. Com
`conversaoDocDisponivel: false` aparece só um aviso discreto: `.docx` continua
funcionando, apenas `.doc` fica indisponível.

### `analisarModelo`

Detecta os campos variáveis do modelo Word.

```ts
// entrada
{ templateBase64: string }
// saída (EstruturaModelo)
{
  placeholders: string[];
  malformados: string[];      // trechos com chaves quebradas: "{{CAMPO}", "{CAMPO}", "{{}}"
  templateBase64: string;     // o .docx convertido; "" quando não houve conversão
  convertidoDeDoc: boolean;
}
```

Aceita `.docx` e `.doc`. O `.doc` é convertido no servidor via LibreOffice e o
resultado volta em `templateBase64` — o cliente passa a usar **esse** arquivo,
para que a geração final opere sobre exatamente o que foi analisado. Sem
conversão o campo volta vazio e o cliente reusa o arquivo que já tem.

Chamada **no momento do upload do modelo** (não ao clicar em "Analisar
documentos"), para que o usuário descubra problemas de estrutura antes de
esperar a extração com IA. O resultado passa por `diagnosticarModelo()` e os
placeholders validados ficam guardados no estado da página — `extrairDados` os
reaproveita, sem uma segunda análise.

Chaves retornadas em dois formatos:

- `NOME_DO_CAMPO` — veio de um `{{NOME_DO_CAMPO}}` no documento;
- `__VERMELHO__::<texto>` — veio de um run em vermelho, onde `<texto>` é o
  próprio conteúdo do trecho.

Lista vazia vira o erro `sem-campos` no diagnóstico, que recusa o modelo.

Erros lançados:

- **`.doc` num ambiente sem LibreOffice** — mensagem com o passo a passo da
  conversão manual no Word;
- **qualquer outro formato** (ou ZIP sem `word/document.xml`) — mensagem de
  formato inválido.

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

- Requer `OPENAI_API_KEY`. Na prática nunca falha por falta de chave: o app já
  bloqueia na abertura (ver `obterStatusConfiguracao`).
- A resposta usa **Structured Outputs** (`response_format: json_schema`, `strict`),
  então o JSON vem garantido pelo esquema. Se a API recusar essa combinação, a
  chamada é repetida sem o esquema e o `JSON.parse` volta a ser o caminho.
- Erros traduzidos: `401/403` chave inválida, `404` modelo inexistente na conta,
  `429` limite ou créditos esgotados, `413` payload grande demais, `5xx`
  indisponibilidade. Timeout configurável e uma retentativa em 429/5xx.
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

| Endpoint                              | Método | Uso                                                                                                                                                                          |
| ------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `${OPENAI_BASE_URL}/chat/completions` | `POST` | Extração multimodal. Modelo de `OPENAI_MODEL` (padrão `gpt-5.4`), `temperature: 0.1`, `response_format` com esquema estrito. Header `Authorization: Bearer <OPENAI_API_KEY>` |

Chamado por [src/lib/openai.server.ts](src/lib/openai.server.ts) com `fetch` puro.
Não usamos o SDK oficial nem o AI SDK: é uma única chamada, e adaptadores
`openai-compatible` não suportam file parts de PDF.
