# CLAUDE.md

Guia para o Claude Code (e outros agentes) trabalharem neste repositório.

## O que é este projeto

Gerador de contratos societários da **Gaulke Contábil**: recebe um modelo Word
(`.docx` ou `.doc`) e documentos da empresa/sócios, extrai os dados com a OpenAI
(visão multimodal, sem OCR separado), submete a
revisão humana e devolve o contrato preenchido preservando a formatação do
modelo. Duas páginas, sem banco de dados.

Documentação de apoio: [README.md](README.md) ·
[ARQUITETURA.md](ARQUITETURA.md) · [ROTAS.md](ROTAS.md) ·
[REGRAS-DE-NEGOCIO.md](REGRAS-DE-NEGOCIO.md)

## Comandos

```bash
bun install
bun run dev      # dev server (porta 8080)
NITRO_PRESET=node-server bun run build   # build de produção
bun run lint     # ESLint (Prettier incluso como regra)
bun run format   # Prettier
```

Precisa de um `.env` com `OPENAI_API_KEY` — sem ela o app exibe a tela de
configuração ausente e não abre. Veja `.env.example`.

Não há suíte de testes. Verificação típica: `npx tsc --noEmit` + exercitar o fluxo
completo no navegador com um modelo e documentos reais (há amostras em
`exemplo-claude/`, fora do versionamento).

## Convenções do código

- **Idioma**: código, comentários, nomes de variáveis, mensagens de erro e UI em
  **português**. Mantenha esse padrão — o domínio é jurídico-contábil brasileiro.
- **Prettier**: `printWidth: 100`, aspas duplas, ponto e vírgula, trailing comma
  `all`. Rode `bun run format` antes de fechar uma alteração.
- **Alias**: `@/` → `src/`.
- **UI**: shadcn/ui (`new-york`) em [src/components/ui/](src/components/ui/) +
  Tailwind v4. Não edite componentes `ui/` sem necessidade; prefira compor.
- **Cores**: use apenas os tokens do design system (`primary`, `accent`, `info`,
  `success`, `warning`, `destructive`, `--missing`) definidos em
  [src/styles.css](src/styles.css). Sem hex solto no JSX.
- **Toasts**: `sonner` (`toast.success` / `toast.error` / `toast.message`).

## Regras específicas deste repositório

### Roteamento

File-based routing do TanStack Start. **Não** crie `src/pages/`, `app/layout.tsx`
ou qualquer convenção Next.js/Remix — veja
[src/routes/README.md](src/routes/README.md). `src/routeTree.gen.ts` é gerado;
nunca edite à mão. Preserve o `<Outlet />` em `__root.tsx`.

### Fronteira cliente/servidor

- Lógica pesada e segredos ficam em `*.server.ts`, importados **dinamicamente**
  dentro dos handlers de `createServerFn` — é isso que mantém `docxtemplater`,
  `pizzip` e a chave de API fora do bundle do cliente. Não converta esses
  `await import()` em imports estáticos.
- Toda server function valida a entrada com Zod no `validator`.
- Variáveis de ambiente têm **um ponto único de leitura**:
  [config.server.ts](src/lib/config.server.ts). Não espalhe `process.env` pelo
  código; a chave da OpenAI nunca pode chegar ao cliente.

### Vite

[vite.config.ts](vite.config.ts) monta os plugins diretamente. Três detalhes que
quebram de forma não óbvia se mexidos:

- **`tanstackStart` precisa vir antes de `viteReact`.**
- **`css.transformer: "lightningcss"`** não é decoração: o padrão do Vite 8 é
  `postcss`, e trocar muda como `color-mix`, nesting e prefixos são gerados —
  regressão visual sem erro de build.
- **`resolve.dedupe`** evita duas cópias de React ("Invalid hook call") e de
  `@tanstack/query-core` (o `QueryClient` do router deixa de ser o que os hooks
  leem — falha silenciosa).

### Dependências

`bunfig.toml` bloqueia versões publicadas há menos de 24h
(`minimumReleaseAge`). Só adicione entradas em `minimumReleaseAgeExcludes` após
confirmar com o usuário.

### Manipulação do `.docx`

Área mais delicada do projeto ([src/lib/contratos.server.ts](src/lib/contratos.server.ts)):

- O Word quebra um mesmo texto entre vários `<w:r>`/`<w:t>`. **Nunca** aplique
  regex de conteúdo diretamente no XML esperando texto contíguo — use
  `limparTextoConsolidado()` (consolida o parágrafo, aplica o regex e redistribui
  nos slots originais) ou consolide o parágrafo antes de detectar.
- Todo texto inserido no XML passa por `escapeXml()`.
- Placeholders sem valor devem **permanecer visíveis** no documento final:
  `nullGetter` re-emite `{{NOME}}` e runs vermelhos sem valor continuam
  vermelhos. Não "limpe" isso — é o mecanismo de conferência.
- Algumas limpezas (`26` antes de "CONTRATO SOCIAL", endereço fixo `nº 266,
Bairro Rio Vermelho Estação`) são **específicas do modelo atual**. Ao mexer
  nelas, confirme com o usuário antes.
- `docx` gerado deve abrir no Word sem aviso de reparo — em caso de dúvida,
  peça ao usuário para validar o arquivo.

### Validação do modelo

O modelo é validado **no upload**, não ao clicar em "Analisar documentos"
([diagnostico-modelo.ts](src/lib/diagnostico-modelo.ts)). Erro ⇒ o arquivo é
descartado e o botão fica desabilitado; aviso ⇒ apenas informa. Ao acrescentar
uma checagem, decida a severidade pelo critério: **bloqueia se o contrato final
puder sair errado sem ninguém perceber**; caso contrário é aviso.

`diagnosticarModelo()` precisa continuar **puro** (sem pizzip) — ele roda no
cliente. Tudo que exigir ler o `.docx` vai em `extrairPlaceholders`, que devolve
a estrutura já pronta para o diagnóstico.

### Conversão de `.doc`

[conversao-doc.server.ts](src/lib/conversao-doc.server.ts) roda `soffice`
headless. Os imports de `node:*` são **dinâmicos de propósito** — é o que mantém
o código funcionando em runtimes sem processo/filesystem (lá a checagem falha e o
fallback assume). Não os torne estáticos. A função devolve `null` em vez de
lançar quando o ambiente não suporta, para o chamador escolher a mensagem.

Produção usa o [Dockerfile](Dockerfile) da raiz: `libreoffice-writer` na imagem e
`NITRO_PRESET=node-server` na build.

### Regras de negócio

As regras jurídicas estão duplicadas por natureza entre o **prompt de sistema**
(`extrairValoresViaIA`), os **formatadores** (`formatters.ts`) e a **tela de
revisão** (`revisao.tsx`). Ao alterar uma regra, verifique os três pontos e
atualize [REGRAS-DE-NEGOCIO.md](REGRAS-DE-NEGOCIO.md).

Pontos que não podem regredir:

- a IA **não inventa** dados: sem evidência → vazio + `faltantes`;
- conflitos entre documentos **não são resolvidos automaticamente**;
- objeto social só vem do **REGIN**, literal e integral;
- data atual sempre é a de hoje em `America/Sao_Paulo`.

Ao adicionar um tipo de campo, trate-o em `detectarTipo()` (na posição correta
de precedência) **e** no `switch` de `aplicarFormatacao()`.

### Privacidade

Documentos são processados em memória e descartados por esta aplicação — mas são
enviados à OpenAI para leitura, então contêm dado pessoal saindo da
infraestrutura do cliente. Não introduza persistência, logging de conteúdo de
documentos, nem envio a qualquer serviço além da OpenAI já utilizada.

### IA

O provedor é a **OpenAI**, via `fetch` puro em
[openai.server.ts](src/lib/openai.server.ts) — sem SDK. A extração usa
**Structured Outputs** com `strict: true`, e o modo estrito não aceita objeto com
chaves arbitrárias: por isso a resposta traz `campos` como **lista**, convertida
para dicionário logo em seguida. Ao mexer no formato da resposta, mexa nos dois
lugares (esquema e conversão) — eles têm que continuar casando.

O projeto **não é mais conectado ao Lovable**. Não reintroduza
`@lovable.dev/*`, `LOVABLE_API_KEY` nem `window.__lovableEvents`.
