# Arquitetura

Aplicação **TanStack Start** (SSR) de duas páginas, sem banco de dados. Todo o
estado de uma sessão de trabalho vive no navegador; o servidor é stateless e
existe para (a) ler/escrever o `.docx` e (b) guardar a chave da IA.

## Visão geral

```
┌──────────────── navegador ─────────────────┐      ┌──────── servidor (SSR/Nitro) ────────┐
│                                            │      │                                       │
│  /  (index.tsx)                            │      │  analisarModelo   → contratos.server │
│   ├─ UploadCard modelo .docx  ─── base64 ──┼─────▶│     extrairPlaceholders()            │
│   └─ UploadCard documentos    ─── base64 ──┼─────▶│  extrairDados                        │
│                                            │      │     extrairValoresViaIA() ──▶ Gateway│
│   sessionStorage                           │◀─────┼─────  placeholders + extração        │
│   "gaulke:contrato:estado"                 │      │                                       │
│         │                                  │      │                                       │
│         ▼                                  │      │                                       │
│  /revisao (revisao.tsx)                    │      │  gerarContrato                        │
│   ├─ formatters.ts (formata/valida)        │      │     gerarDocxPreenchido()             │
│   └─ valores revisados ─────────────────── ┼─────▶│        pizzip + docxtemplater         │
│   mammoth → prévia HTML  ◀──── docx base64 │◀─────┼─────  docxBase64                      │
│   download .docx                           │      │                                       │
└────────────────────────────────────────────┘      └───────────────────────────────────────┘
```

## Camadas e arquivos

### Entradas do runtime

| Arquivo                                          | Papel                                                                                                                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/server.ts](src/server.ts)                   | Entrada SSR customizada. Envolve `@tanstack/react-start/server-entry`, captura erros catastróficos e devolve uma página de erro HTML em vez do 500 genérico do h3 |
| [src/start.ts](src/start.ts)                     | `createStart` com middleware de request que converte exceções não tratadas em página de erro (preservando erros com `statusCode`)                                 |
| [src/router.tsx](src/router.tsx)                 | `createRouter` com `QueryClient` no contexto, `scrollRestoration` ligado                                                                                          |
| [src/routes/\_\_root.tsx](src/routes/__root.tsx) | Shell HTML, `QueryClientProvider`, `Toaster`, `notFoundComponent` e `errorComponent`                                                                              |
| [src/routeTree.gen.ts](src/routeTree.gen.ts)     | Árvore de rotas **gerada** — não editar                                                                                                                           |

O redirecionamento da entrada do servidor para `src/server.ts` é configurado em
[vite.config.ts](vite.config.ts) (`tanstackStart.server.entry`).

### Camada de página (client)

| Arquivo                                                        | Papel                                                                                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/routes/index.tsx](src/routes/index.tsx)                   | Upload do modelo e dos documentos; orquestra `analisarModelo` → `extrairDados`; grava o estado em `sessionStorage` e navega para `/revisao` |
| [src/routes/revisao.tsx](src/routes/revisao.tsx)               | Formulário de revisão, validações, sincronização de campos "por extenso", geração e prévia                                                  |
| [src/components/UploadCard.tsx](src/components/UploadCard.tsx) | Drag & drop, limite de tamanho/quantidade, leitura para base64 via `FileReader`                                                             |
| [src/components/SiteHeader.tsx](src/components/SiteHeader.tsx) | Cabeçalho institucional                                                                                                                     |
| [src/components/ui/](src/components/ui/)                       | Componentes shadcn/ui (não customizar sem necessidade)                                                                                      |

### Camada de servidor

| Arquivo                                                          | Papel                                                                                           |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [src/lib/contratos.functions.ts](src/lib/contratos.functions.ts) | Três `createServerFn` com validação Zod. É a **fronteira** cliente↔servidor                     |
| [src/lib/contratos.server.ts](src/lib/contratos.server.ts)       | Toda a lógica pesada: detecção de placeholders, prompt e chamada à IA, montagem do `.docx`      |
| [src/lib/ai-gateway.server.ts](src/lib/ai-gateway.server.ts)     | Provider AI SDK para o gateway Lovable (**atualmente não usado** na extração — ver nota abaixo) |

`contratos.server.ts` é importado **dinamicamente** dentro dos handlers
(`await import("./contratos.server")`) para que o bundle do cliente nunca o
inclua.

### Utilitários compartilhados

| Arquivo                                                                  | Papel                                                                                                                                        |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/lib/formatters.ts](src/lib/formatters.ts)                           | Formatação e validação pt-BR: CPF/CNPJ/CEP/telefone/moeda/data, Title Case com preposições, endereços, números por extenso, `detectarTipo()` |
| [src/lib/utils.ts](src/lib/utils.ts)                                     | `cn()` (clsx + tailwind-merge)                                                                                                               |
| [src/lib/error-capture.ts](src/lib/error-capture.ts)                     | Guarda o último erro global (TTL 5s) para recuperar o stack quando o h3 já engoliu o throw                                                   |
| [src/lib/error-page.ts](src/lib/error-page.ts)                           | HTML estático da página de erro do servidor                                                                                                  |
| [src/lib/lovable-error-reporting.ts](src/lib/lovable-error-reporting.ts) | Envia exceções de error boundary para `window.__lovableEvents`                                                                               |
| [src/hooks/use-mobile.tsx](src/hooks/use-mobile.tsx)                     | Breakpoint hook do shadcn                                                                                                                    |

## Fluxo de dados detalhado

### 1. Análise do modelo — `analisarModelo`

`extrairPlaceholders(templateBase64)` abre o `.docx` com **pizzip**, lê
`word/document.xml` e busca campos de duas formas:

1. **`{{TAG}}`** — o XML é varrido parágrafo a parágrafo (`<w:p>…</w:p>`) e o
   texto de todos os `<w:t>` do parágrafo é concatenado antes do regex. Isso é
   necessário porque o Word quebra um mesmo placeholder em vários `<w:r>`
   (corretor ortográfico, revisões), o que faria um regex ingênuo falhar.
2. **Runs em vermelho** — qualquer `<w:r>` cujo XML contenha uma das cores
   `FF0000|C00000|ED1C24|E81123|DC143C` e tenha texto não vazio vira um campo
   com a chave prefixada: `__VERMELHO__::<texto do run>`.

O retorno é a lista ordenada de chaves (a ordem de inserção do `Set` é estável).

### 2. Extração com IA — `extrairDados`

`extrairValoresViaIA(apiKey, placeholders, arquivos)`:

- Monta um **prompt de sistema** extenso com as regras de negócio (ver
  [REGRAS-DE-NEGOCIO.md](REGRAS-DE-NEGOCIO.md)) e um prompt de usuário com a
  lista numerada de campos e o schema JSON esperado.
- Constrói uma mensagem **multimodal** no formato OpenAI-compatible: imagens
  como `image_url` (data URI) e PDFs como parte `file` com `file_data`.
- Faz `fetch` **direto** em `https://ai.gateway.lovable.dev/v1/chat/completions`
  com os headers `Lovable-API-Key` e `X-Lovable-AIG-SDK`, modelo
  `google/gemini-3-flash-preview`, `temperature: 0.1`.

  > **Por que não o AI SDK?** O adapter `@ai-sdk/openai-compatible` não suporta
  > file parts `application/pdf`. `ai-gateway.server.ts` existe como provider
  > pronto caso isso mude, mas hoje não é chamado.

- Traduz erros HTTP em mensagens de usuário: `429` → limite de uso atingido;
  `402` → créditos esgotados; demais → erro com trecho do corpo.
- Remove cercas markdown e faz `JSON.parse`; JSON inválido vira erro amigável.
- **Normaliza**: garante que todo placeholder solicitado exista no resultado
  (ausentes viram `{ valor: "", fonte: "—", confianca: "baixa" }`), força a data
  atual (fuso `America/Sao_Paulo`) em campos que pareçam "data atual/hoje/
  emissão/geração" e propaga meta-campos `__META_*`.

Retorno: `{ valores, faltantes, conflitos, observacoes }`.

### 3. Revisão (client)

`/revisao` lê `sessionStorage["gaulke:contrato:estado"]` (redireciona para `/`
se ausente) e:

- Classifica cada campo com `detectarTipo()` e aplica `aplicarFormatacao()` nos
  valores iniciais e no `onBlur` de cada input.
- Renderiza `Select` para estado civil, `Textarea` para campos longos (objeto
  social, endereço, "por extenso") e `Input` nos demais.
- Mantém dois campos derivados sincronizados por efeito: capital social →
  `moedaPorExtenso`, quotas → `quotasPorExtenso`.
- Calcula a lista de `problemas` (erros bloqueiam a geração; avisos não) e exibe
  conflitos, faltantes e observações da IA no painel lateral.
- Exige seleção de **regime de bens** quando o estado civil contém "casad".
- Permite escolher **RG ou CNH** manualmente, sobrescrevendo o que a IA detectou
  (`__META_TIPO_DOC_IDENTIDADE__`).

### 4. Geração do `.docx` — `gerarContrato`

`gerarDocxPreenchido(templateBase64, valores)` opera sobre
`word/document.xml` na seguinte ordem:

1. **Caixa alta** — valores de campos identificados por `ehCampoEmpresaOuSocio()`
   (razão social, nome empresarial, denominação social, sócio/sócia,
   administrador) viram `toLocaleUpperCase("pt-BR")`.
2. **Limpezas do modelo** — remoção de resíduos herdados do contrato anterior
   (o `26` antes de "CONTRATO SOCIAL", o endereço fixo `nº 266, Bairro Rio
Vermelho Estação, CEP 89.292-580`) e normalização da menção ao documento de
   identidade para "Carteira Nacional de Habilitação" / "Carteira de Identidade"
   conforme `__META_TIPO_DOC_IDENTIDADE__`.
3. **Negrito** — `forcarNegritoEmTags()` injeta `<w:b/><w:bCs/>` no `<w:rPr>`
   dos runs que contêm `{{TAG}}` de empresa/sócio.
4. **Runs vermelhos** — `substituirRunsVermelhos()` troca o conteúdo do primeiro
   `<w:t>` do run pelo valor (demais `<w:t>` do run ficam vazios) e mantém o run
   vermelho intacto quando não há valor correspondente — assim campos não
   resolvidos continuam visualmente destacados no documento final.
5. **docxtemplater** — roda com `delimiters: { start: "{{", end: "}}" }`,
   `paragraphLoop`, `linebreaks` e um `nullGetter` que **re-emite o placeholder**
   quando não há valor. Cada chave é registrada duas vezes (crua e `.trim()`)
   para tolerar espaços dentro das chaves.
6. **Fallback** — se `doc.render()` lançar, o erro é logado e
   `substituirPlaceholdersManual()` faz a substituição por regex direto no XML.

Ferramenta central de edição de texto: `limparTextoConsolidado(xml, padrao,
substituto)` — aplica um regex sobre o **texto consolidado do parágrafo** e
redistribui o resultado nos `<w:t>` originais, o que permite tratar trechos
divididos entre vários runs. Todo texto inserido passa por `escapeXml()`.

### 5. Prévia e download

O base64 retornado é convertido para HTML por **mammoth** no cliente e exibido
num `Dialog`. O download monta um `Blob` com o MIME de `.docx` e nomeia o arquivo
como `<modelo>_preenchido_<AAAA-MM-DD>.docx`.

## Tratamento de erros

Três camadas independentes:

- **Cliente** — `errorComponent` no root + `reportLovableError()`; erros de
  mutation viram `toast.error`.
- **Request** — middleware em `src/start.ts` intercepta throws de server
  functions/loaders que não tenham `statusCode`.
- **SSR** — `src/server.ts` detecta o 500 JSON genérico do h3
  (`{"unhandled":true,"message":"HTTPError"}`), recupera o erro real via
  `consumeLastCapturedError()` e devolve a página de erro HTML.

## Design system

Definido em [src/styles.css](src/styles.css) com Tailwind v4 (`@theme inline`) e
variáveis CSS em oklch. Cores institucionais de uso exclusivo:

| Token        | Hex       | Uso                                                          |
| ------------ | --------- | ------------------------------------------------------------ |
| `primary`    | `#343881` | Cabeçalho, navegação                                         |
| `accent`     | `#F49D37` | CTA / ação principal                                         |
| `info`       | `#0D6DAC` | Links, detalhes, gráficos                                    |
| `background` | `#FFFFFF` | Fundo                                                        |
| `foreground` | `#1A1A1A` | Texto                                                        |
| `--missing`  | —         | Campos não preenchidos (equivalente ao "vermelho" do modelo) |

Tipografia: **Open Sans** (`@fontsource/open-sans`, pesos 400/600/700).

## Limites conhecidos

- Sem persistência: recarregar a aba mantém o estado (sessionStorage), mas
  fechar a aba perde tudo.
- Arquivos trafegam em base64 no corpo da requisição — o limite prático é o
  limite de payload do runtime; a UI restringe a 20 MB por arquivo e 10 arquivos.
- Várias limpezas em `gerarDocxPreenchido` são **específicas do modelo atual**
  da Gaulke (resíduo "26", endereço fixo). Modelos diferentes podem exigir
  ajuste dessas regras.
- `consolidarRunsXML()` é um no-op mantido apenas como documentação da
  estratégia adotada (consolidar para detectar, não para reescrever).
