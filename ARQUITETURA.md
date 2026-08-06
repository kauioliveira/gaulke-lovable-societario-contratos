# Arquitetura

Aplicação **TanStack Start** (SSR) de duas páginas, sem banco de dados. Todo o
estado de uma sessão de trabalho vive no navegador; o servidor é stateless e
existe para (a) ler/escrever o `.docx`, (b) converter `.doc` via LibreOffice e
(c) guardar a chave da OpenAI.

Sem `OPENAI_API_KEY` configurada, o `loader` da rota raiz detecta a ausência e o
aplicativo nem abre — ver [Bloqueio na abertura](#bloqueio-na-abertura).

## Visão geral

```
┌──────────────── navegador ─────────────────┐      ┌──────── servidor (SSR/Nitro) ────────┐
│                                            │      │                                       │
│  /  (index.tsx)                            │      │  analisarModelo   → contratos.server │
│   ├─ UploadCard modelo .docx  ─── base64 ──┼─────▶│     extrairPlaceholders()            │
│   └─ UploadCard documentos    ─── base64 ──┼─────▶│  extrairDados                        │
│                                            │      │     extrairValoresViaIA() ──▶ OpenAI │
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

| Arquivo                                                        | Papel                                                                                                                                                                                     |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/routes/index.tsx](src/routes/index.tsx)                   | Upload do modelo e dos documentos; valida o modelo no upload (`analisarModelo` + `diagnosticarModelo`), chama `extrairDados`; grava o estado em `sessionStorage` e navega para `/revisao` |
| [src/routes/revisao.tsx](src/routes/revisao.tsx)               | Formulário de revisão, validações, sincronização de campos "por extenso", geração e prévia                                                                                                |
| [src/components/UploadCard.tsx](src/components/UploadCard.tsx) | Drag & drop, limite de tamanho/quantidade, leitura para base64 via `FileReader`                                                                                                           |
| [src/components/SiteHeader.tsx](src/components/SiteHeader.tsx) | Cabeçalho institucional                                                                                                                                                                   |
| [src/components/ui/](src/components/ui/)                       | Componentes shadcn/ui (não customizar sem necessidade)                                                                                                                                    |

### Camada de servidor

| Arquivo                                                          | Papel                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [src/lib/contratos.functions.ts](src/lib/contratos.functions.ts) | Três `createServerFn` com validação Zod. É a **fronteira** cliente↔servidor                |
| [src/lib/contratos.server.ts](src/lib/contratos.server.ts)       | Toda a lógica pesada: detecção de placeholders, prompt e chamada à IA, montagem do `.docx` |
| [src/lib/openai.server.ts](src/lib/openai.server.ts)             | Cliente HTTP da OpenAI: timeout, retentativa, tradução de erros e Structured Outputs       |
| [src/lib/config.server.ts](src/lib/config.server.ts)             | Ponto único de leitura de variáveis de ambiente                                            |

`contratos.server.ts` é importado **dinamicamente** dentro dos handlers
(`await import("./contratos.server")`) para que o bundle do cliente nunca o
inclua.

### Utilitários compartilhados

| Arquivo                                                        | Papel                                                                                                                                        |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/lib/formato-documento.ts](src/lib/formato-documento.ts)   | Detecção do formato real do arquivo (`.docx` / `.doc` / `.rtf`) por magic bytes; usado no cliente e no servidor                              |
| [src/lib/diagnostico-modelo.ts](src/lib/diagnostico-modelo.ts) | `diagnosticarModelo()` — validação estrutural do modelo (erros que bloqueiam × avisos). Puro, roda no cliente                                |
| [src/lib/endereco-campos.ts](src/lib/endereco-campos.ts)       | Campos sintéticos de endereço (`__ENDSOCIO_*`, `__ENDEMPRESA_*`): nomes, rótulos e trecho do prompt. Puro                                    |
| [src/lib/formatters.ts](src/lib/formatters.ts)                 | Formatação e validação pt-BR: CPF/CNPJ/CEP/telefone/moeda/data, Title Case com preposições, endereços, números por extenso, `detectarTipo()` |
| [src/lib/utils.ts](src/lib/utils.ts)                           | `cn()` (clsx + tailwind-merge)                                                                                                               |
| [src/lib/error-capture.ts](src/lib/error-capture.ts)           | Guarda o último erro global (TTL 5s) para recuperar o stack quando o h3 já engoliu o throw                                                   |
| [src/lib/error-page.ts](src/lib/error-page.ts)                 | HTML estático da página de erro do servidor                                                                                                  |
| [src/hooks/use-mobile.tsx](src/hooks/use-mobile.tsx)           | Breakpoint hook do shadcn                                                                                                                    |

## Fluxo de dados detalhado

### 1. Análise do modelo — `analisarModelo`

`extrairPlaceholders(templateBase64)` abre o `.docx` com `abrirDocx()` (que
valida o formato — ver abaixo), lê `word/document.xml` e busca campos de duas
formas:

1. **`{{TAG}}`** — o XML é varrido parágrafo a parágrafo (`<w:p>…</w:p>`) e o
   texto de todos os `<w:t>` do parágrafo é concatenado antes do regex. Isso é
   necessário porque o Word quebra um mesmo placeholder em vários `<w:r>`
   (corretor ortográfico, revisões), o que faria um regex ingênuo falhar.
2. **Runs em vermelho** — qualquer `<w:r>` cujo XML contenha uma das cores
   `FF0000|C00000|ED1C24|E81123|DC143C` e tenha texto não vazio vira um campo
   com a chave prefixada: `__VERMELHO__::<texto do run>`.

O retorno é a lista ordenada de chaves (a ordem de inserção do `Set` é estável).

#### Validação de formato — `abrirDocx()`

O `.doc` legado (Word 97-2003) é um container **OLE2**, não um ZIP — mas quase
sempre **embute um ZIP interno** com os dados de tema do Word. O pizzip abre esse
ZIP embutido **sem lançar erro**, o `word/document.xml` não existe, e o resultado
era zero placeholders: a aplicação dizia "nenhum campo variável encontrado",
sugerindo um erro no modelo quando o problema era o formato do arquivo.

Por isso a validação é feita pelas **assinaturas dos primeiros bytes** antes de
tentar abrir o ZIP, em [src/lib/formato-documento.ts](src/lib/formato-documento.ts):

| Formato             | Magic bytes        | Prefixo em base64 | Resultado                       |
| ------------------- | ------------------ | ----------------- | ------------------------------- |
| `.docx` (ZIP/OOXML) | `PK\x03\x04`       | `UEsDB`           | Segue o fluxo                   |
| `.doc` (OLE2)       | `D0CF11E0A1B11AE1` | `0M8R4KGxGuE`     | Erro com instrução de conversão |
| `.rtf`              | `{\rtf`            | `e1xydGY`         | Erro de formato inválido        |

O módulo é puro e roda nos dois lados: o cliente valida antes de subir o arquivo
(evita o round-trip) e o servidor revalida como fonte de verdade. `abrirDocx()`
ainda confirma a presença de `word/document.xml` — um ZIP qualquer renomeado para
`.docx` também é rejeitado. A mesma função é usada por `gerarDocxPreenchido`.

#### Conversão de `.doc` — `converterDocParaDocx()`

Quando o formato detectado é `doc`, `normalizarParaDocx()` chama
[conversao-doc.server.ts](src/lib/conversao-doc.server.ts), que grava o arquivo
num diretório temporário e roda:

```
soffice -env:UserInstallation=file://<tmp>/perfil --headless --norestore \
        --convert-to docx --outdir <tmp> <arquivo>
```

O `-env:UserInstallation` dá um perfil próprio a cada execução — sem isso duas
conversões simultâneas disputam o lock do perfil padrão e uma falha. O diretório
temporário é removido no `finally`.

A função devolve `null` (em vez de lançar) quando o runtime não tem
subprocessos, filesystem ou o binário — aí `normalizarParaDocx` lança
`MENSAGEM_CONVERSAO_DOC` e o usuário recebe a instrução de converter no Word. A
disponibilidade é testada uma vez (`soffice --version`) e memoizada.

Os imports de `node:*` são todos dinâmicos, então o código continua funcionando
em runtimes sem processo/filesystem: a checagem falha e o caminho de fallback
assume, exibindo o aviso de LibreOffice indisponível.

**O `.docx` convertido substitui o original.** `extrairPlaceholders` devolve
`templateBase64` e `convertidoDeDoc`; o cliente passa a usar esse arquivo dali em
diante, para que a geração final opere exatamente sobre o que foi analisado — e
não converta de novo. Sem conversão, `templateBase64` volta vazio e o cliente
reusa o arquivo que já tem, evitando um round-trip inútil.

#### Diagnóstico estrutural — `diagnosticarModelo()`

`extrairPlaceholders` devolve, além dos placeholders, os trechos com **chaves
quebradas** (`{{CAMPO}`, `{CAMPO}`, `{{}}`): `chavesMalformadas()` remove do
texto consolidado do parágrafo todas as tags bem formadas e reporta o que sobrou
com `{` ou `}`. Esses casos são o pior tipo de falha silenciosa — o docxtemplater
não os reconhece e o marcador sai literal no contrato assinado.

[src/lib/diagnostico-modelo.ts](src/lib/diagnostico-modelo.ts) transforma essa
estrutura em erros e avisos. É **puro** (não depende de pizzip), então roda no
cliente logo após a resposta de `analisarModelo`:

| Código                  | Severidade | Detecção                                                                                    |
| ----------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| `sem-campos`            | Erro       | `placeholders.length === 0`                                                                 |
| `chave-malformada`      | Erro       | Trechos com chaves sobrando/faltando                                                        |
| `campo-sem-nome`        | Erro       | `{{}}` / `{{ }}`                                                                            |
| `grafias-divergentes`   | Erro       | Nomes distintos que colidem na normalização (sem acento, minúsculo, `_`/espaços colapsados) |
| `espacamento-irregular` | Aviso      | `_ `, ` _`, espaços duplos                                                                  |
| `placeholder-rotulo`    | Aviso      | Campo em vermelho cujo texto é só um rótulo conhecido                                       |

Na página inicial, erro ⇒ o arquivo é **descartado** (`setModelo([])`) e
`modeloValidado` volta a `null`, desabilitando o botão de análise. Sem erros, os
placeholders e o `.docx` efetivo ficam no estado e `extrairDados` os reaproveita
— o modelo não é analisado duas vezes.

#### Grafias equivalentes — `agruparGrafiasEquivalentes()`

`{{SOCIO}}` e `{{SÓCIO}}` são marcadores distintos no Word, mas o mesmo campo.
A normalização usada para detectá-los é a **mesma** de `detectarTipo()` (sem
acento, minúsculo, `_`/espaços colapsados).

Isso **bloqueia** o upload: cada campo precisa de um nome canônico único no
modelo. Sem isso, qualquer coisa que futuramente busque um campo pelo nome —
auditoria, varredura em lote, mapeamento fixo de campo → regra — encontra duas
grafias concorrentes e falha ou escolhe a errada. Exigir a padronização no Word,
uma vez, evita esse problema para sempre.

A mesma função é usada pela tela de revisão para renderizar **um card por
grupo**, com `equivalentes` carregando todas as chaves e a geração replicando o
valor em todas. Como o upload já barra duplicidades, na prática todo grupo tem um
único elemento — o agrupamento fica como rede de segurança, garantindo que
grafias equivalentes jamais recebam valores diferentes caso alguma escape.

#### Endereço em componentes

O modelo costuma ter **um** marcador com o endereço inteiro. Isso impede
conferência peça a peça, então a extração pede os componentes separados sob nomes
sintéticos ([endereco-campos.ts](src/lib/endereco-campos.ts)):
`__ENDSOCIO_LOGRADOURO__`, `__ENDSOCIO_NUMERO__`, `__ENDSOCIO_BAIRRO__`… e o
mesmo para `__ENDEMPRESA_*`.

Esses nomes não existem no Word: são acrescentados à lista enviada à IA quando
`detectarTipo()` encontra um placeholder `enderecoSocio`/`enderecoEmpresa`, e
sobrevivem à normalização pelo mesmo caminho dos `__META_*`. A tela de revisão
renderiza um card com um input por peça e mostra a linha montada logo abaixo; a
geração escreve essa linha no marcador composto.

Na prática isso separa dois endereços que antes se misturavam: o do sócio sai do
comprovante de residência, o da empresa sai do REGIN.

Se a IA ignorar os componentes e devolver só a linha inteira,
`decomporEndereco()` a quebra nas peças — a tela nunca fica sem o que conferir.

### Bloqueio na abertura

A rota raiz ([\_\_root.tsx](src/routes/__root.tsx)) tem um `loader` — a única rota
do projeto que tem — chamando `obterStatusConfiguracao`, que devolve apenas
`{ iaConfigurada, conversaoDocDisponivel, modelo }`. **A chave nunca sai do
servidor.**

Sem chave, `RootComponent` renderiza a tela de configuração ausente no lugar do
`<Outlet />`: o app inteiro fica inacessível, com as instruções de como
configurar. Antes, a falta de chave só aparecia depois de subir modelo e
documentos e clicar em analisar.

`conversaoDocDisponivel: false` não bloqueia — mostra só um aviso no canto,
porque `.docx` continua funcionando e apenas `.doc` fica indisponível.

### 2. Extração com IA — `extrairDados`

`extrairValoresViaIA(apiKey, placeholders, arquivos)`:

- Monta um **prompt de sistema** extenso com as regras de negócio (ver
  [REGRAS-DE-NEGOCIO.md](REGRAS-DE-NEGOCIO.md)) e um prompt de usuário com a
  lista numerada de campos e o schema JSON esperado.
- Constrói uma mensagem **multimodal** no formato OpenAI-compatible: imagens
  como `image_url` (data URI) e PDFs como parte `file` com `file_data`.
- Delega a chamada a [openai.server.ts](src/lib/openai.server.ts):
  `POST ${OPENAI_BASE_URL}/chat/completions`, `Authorization: Bearer`, modelo de
  `OPENAI_MODEL` (padrão `gpt-5.4`), `temperature: 0.1`.

  > **Por que não o SDK?** É uma única chamada HTTP, e os adaptadores
  > `openai-compatible` não suportam file parts `application/pdf` — justamente o
  > que precisamos. `fetch` puro evita a dependência e a limitação.

- Usa **Structured Outputs** (ver adiante), com timeout de `OPENAI_TIMEOUT_MS` e
  uma retentativa em 429/5xx.
- Traduz os erros HTTP em mensagens acionáveis (401 chave inválida, 404 modelo
  inexistente, 429 limite/créditos, 413 payload grande demais, 5xx
  indisponibilidade) e trata `refusal` e corte por `finish_reason: "length"`.
- **Normaliza**: garante que todo placeholder solicitado exista no resultado
  (ausentes viram `{ valor: "", fonte: "—", confianca: "baixa" }`), força a data
  atual (fuso `America/Sao_Paulo`) em campos que pareçam "data atual/hoje/
  emissão/geração" e propaga meta-campos `__META_*`.

#### Por que não há OCR

Em PDF, a API da OpenAI extrai o texto **e** renderiza cada página como imagem,
mandando as duas coisas ao modelo. Documento escaneado ou fotografado (CNH,
comprovante de residência) é lido pela via de visão, sem serviço de OCR à parte.

#### Structured Outputs

A requisição envia `response_format: { type: "json_schema", strict: true }`. O
modo estrito impõe duas restrições que moldam o formato da resposta: todo objeto
precisa de `additionalProperties: false` com todas as propriedades em `required`,
e **não aceita dicionário de chaves arbitrárias**.

Por isso a IA devolve `campos` como **lista** de `{ nome, valor, fonte,
confianca }` em vez de um objeto indexado pelo nome do campo. Logo após o parse,
a lista é convertida no `Record` que o resto do sistema já consumia — a
assinatura de `extrairValoresViaIA` não mudou, então `revisao.tsx` e o
`sessionStorage` ficaram intocados.

Se a API recusar a combinação de esquema estrito com entrada de arquivo (erro 400
citando `response_format`), a chamada é repetida sem ele: o prompt já descreve o
JSON esperado, então o `JSON.parse` com remoção de cercas markdown continua como
rede de segurança.

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

- **Cliente** — `errorComponent` no root; erros de mutation viram `toast.error`.
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
