# Gerador de Contratos Societários — Gaulke Contábil

Aplicação web que preenche automaticamente contratos sociais em Word (`.docx`) a
partir dos documentos da empresa e dos sócios (viabilidade/REGIN, DBE, ficha
cadastral, RG, CNH, comprovante de residência, contratos anteriores).

O usuário envia o **modelo** de contrato e os **documentos de origem**; a
aplicação detecta os campos variáveis do modelo, extrai os dados dos documentos
com IA multimodal, apresenta uma tela de **revisão humana** e gera o `.docx`
final preservando integralmente a formatação jurídica do modelo.

## Índice da documentação

| Documento                                    | Conteúdo                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| [ARQUITETURA.md](ARQUITETURA.md)             | Camadas, fluxo de dados, pipeline de manipulação do `.docx`, tratamento de erros |
| [ROTAS.md](ROTAS.md)                         | Rotas de página e server functions (contratos de entrada/saída)                  |
| [REGRAS-DE-NEGOCIO.md](REGRAS-DE-NEGOCIO.md) | Regras de extração, formatação pt-BR, validações e casos especiais               |
| [CLAUDE.md](CLAUDE.md)                       | Guia para agentes de IA que trabalham neste repositório                          |

## Stack

- **TanStack Start** (SSR + file-based routing) sobre **Vite 8** e **Nitro**
- **React 19**, **TypeScript** (strict)
- **TanStack Router** + **TanStack Query**
- **Tailwind CSS v4** + **shadcn/ui** (estilo `new-york`) + **lucide-react**
- **docxtemplater** + **pizzip** para escrita do `.docx`; **mammoth** para a prévia HTML
- **Zod** para validação das entradas das server functions
- Gateway de IA da Lovable (`ai.gateway.lovable.dev`), modelo `google/gemini-3-flash-preview`
- Gerenciador de pacotes: **Bun**

## Requisitos

- Bun (o repositório versiona `bun.lock` e `bunfig.toml`)
- Node 20+ (para o toolchain do Vite)
- `LOVABLE_API_KEY` no ambiente do servidor

## Instalação e execução

```bash
bun install
bun run dev        # servidor de desenvolvimento (Vite + SSR)
```

Scripts disponíveis (`package.json`):

| Script              | Descrição                                             |
| ------------------- | ----------------------------------------------------- |
| `bun run dev`       | Servidor de desenvolvimento                           |
| `bun run build`     | Build de produção (Nitro, alvo Cloudflare por padrão) |
| `bun run build:dev` | Build em modo development                             |
| `bun run preview`   | Serve o build local                                   |
| `bun run lint`      | ESLint (inclui Prettier como regra)                   |
| `bun run format`    | Prettier em todo o projeto                            |

> `bunfig.toml` aplica um guarda de supply-chain de 24h (`minimumReleaseAge`):
> versões publicadas há menos de um dia são ignoradas na instalação. Só adicione
> exceções em `minimumReleaseAgeExcludes` após confirmação.

## Variáveis de ambiente

| Variável          | Onde é usada                                                                                                    | Obrigatória                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `LOVABLE_API_KEY` | `extrairDados` em [src/lib/contratos.functions.ts](src/lib/contratos.functions.ts) — autentica no gateway de IA | Sim, para a etapa de extração |

A chave é lida **apenas no servidor** (`process.env`) e nunca chega ao browser.

## Como usar

1. **Página inicial (`/`)** — envie o modelo `.docx` (1 arquivo) e de 1 a 10
   documentos de origem em PDF/JPG/PNG/WEBP (até 20 MB cada).
2. Clique em **Analisar documentos**. O servidor lê o modelo, lista os campos
   variáveis e chama a IA para extrair os valores dos documentos.
3. **Página de revisão (`/revisao`)** — confira e corrija cada campo. A tela
   sinaliza campos em branco, CPF/CNPJ inválidos, CEP fora do padrão, conflitos
   entre documentos e dados não encontrados. Campos obrigatórios bloqueiam a
   geração.
4. Clique em **Pré-visualizar contrato** para ver o resultado em HTML e então
   **Baixar .docx**.

### Como marcar campos no modelo Word

O detector aceita duas formas de marcação, que podem coexistir no mesmo modelo:

- **Placeholders** no formato `{{NOME_DO_CAMPO}}`;
- **Texto em vermelho** (`FF0000`, `C00000`, `ED1C24`, `E81123`, `DC143C`) — o
  próprio texto do trecho vira o nome do campo.

Se nenhum dos dois for encontrado, a análise falha com uma mensagem explicando
as marcações aceitas.

## Privacidade

Os arquivos trafegam em base64, são processados em memória no servidor e não são
persistidos. O estado intermediário entre as duas páginas fica em
`sessionStorage` do navegador, sob a chave `gaulke:contrato:estado`.

## Integração com Lovable

Este projeto é conectado ao [Lovable](https://lovable.dev). **Não reescreva
histórico já publicado** (force push, rebase/amend/squash de commits enviados) —
isso reescreve o histórico do lado do Lovable. Commits enviados ao branch
conectado sincronizam com o editor, então mantenha o branch sempre funcional.
