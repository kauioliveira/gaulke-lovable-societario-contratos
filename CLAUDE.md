# CLAUDE.md

Guia para o Claude Code (e outros agentes) trabalharem neste repositório.

## O que é este projeto

Gerador de contratos societários da **Gaulke Contábil**: recebe um modelo `.docx`
e documentos da empresa/sócios, extrai os dados com IA multimodal, submete a
revisão humana e devolve o contrato preenchido preservando a formatação do
modelo. Duas páginas, sem banco de dados.

Documentação de apoio: [README.md](README.md) ·
[ARQUITETURA.md](ARQUITETURA.md) · [ROTAS.md](ROTAS.md) ·
[REGRAS-DE-NEGOCIO.md](REGRAS-DE-NEGOCIO.md)

## Comandos

```bash
bun install
bun run dev      # dev server
bun run build    # build de produção
bun run lint     # ESLint (Prettier incluso como regra)
bun run format   # Prettier
```

Não há suíte de testes. Verificação típica: `bun run lint` + exercitar o fluxo
completo no navegador com um modelo e documentos reais.

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
- Toda server function valida a entrada com Zod no `inputValidator`.
- `LOVABLE_API_KEY` só é lida via `process.env` no servidor.

### Vite

[vite.config.ts](vite.config.ts) usa `@lovable.dev/vite-tanstack-config`, que já
inclui `tanstackStart`, `viteReact`, `tailwindcss`, `tsConfigPaths`, `nitro`,
componentTagger, injeção de `VITE_*`, alias `@` e dedupe. **Adicionar esses
plugins manualmente quebra o app** com plugins duplicados.

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

Documentos são processados em memória e descartados. Não introduza persistência,
logging de conteúdo de documentos ou envio a serviços de terceiros além do
gateway de IA já utilizado.

## Git / Lovable

O repositório é conectado ao Lovable. **Não reescreva histórico publicado** — nada
de force push, rebase, amend ou squash em commits já enviados; isso corrompe o
histórico do projeto no Lovable. Commits no branch conectado sincronizam com o
editor, então mantenha o branch sempre em estado funcional.
