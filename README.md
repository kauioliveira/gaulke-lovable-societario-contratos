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
- **OpenAI** (`api.openai.com`) para a leitura dos documentos — modelo configurável, padrão `gpt-5.4`
- Gerenciador de pacotes: **Bun**

## Requisitos

- Bun (o repositório versiona `bun.lock` e `bunfig.toml`)
- Node 20+ (para o toolchain do Vite)
- Uma chave da OpenAI em `OPENAI_API_KEY` (o app não abre sem ela)
- LibreOffice (`soffice`) — opcional; só para aceitar modelos `.doc`

## Instalação e execução

```bash
bun install
bun run dev        # servidor de desenvolvimento (Vite + SSR)
```

Scripts disponíveis (`package.json`):

| Script            | Descrição                                                 |
| ----------------- | --------------------------------------------------------- |
| `bun run dev`     | Servidor de desenvolvimento                               |
| `bun run build`   | Build de produção (Nitro; use `NITRO_PRESET=node-server`) |
| `bun run preview` | Serve o build local                                       |
| `bun run lint`    | ESLint (inclui Prettier como regra)                       |
| `bun run format`  | Prettier em todo o projeto                                |

> `bunfig.toml` aplica um guarda de supply-chain de 24h (`minimumReleaseAge`):
> versões publicadas há menos de um dia são ignoradas na instalação. Só adicione
> exceções em `minimumReleaseAgeExcludes` após confirmação.

## Variáveis de ambiente

| Variável            | Onde é usada                                                                                                              | Obrigatória |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `OPENAI_API_KEY`    | Autentica na OpenAI. Sem ela o aplicativo exibe uma tela de configuração e não abre                                       | **Sim**     |
| `OPENAI_MODEL`      | Modelo da extração (padrão `gpt-5.4`); precisa ter visão e structured outputs                                             | Não         |
| `OPENAI_BASE_URL`   | Endpoint alternativo (proxy, Azure OpenAI). Padrão `https://api.openai.com/v1`                                            | Não         |
| `OPENAI_TIMEOUT_MS` | Tempo máximo de uma chamada à IA (padrão 120000)                                                                          | Não         |
| `LIBREOFFICE_BIN`   | [src/lib/conversao-doc.server.ts](src/lib/conversao-doc.server.ts) — caminho do binário do LibreOffice (padrão `soffice`) | Não         |

A chave é lida **apenas no servidor** (`process.env`) e nunca chega ao browser.

## Como usar

1. **Página inicial (`/`)** — envie o modelo `.docx` ou `.doc` (1 arquivo). Ele é validado
   na hora: havendo erros de estrutura, o arquivo é recusado e os problemas
   aparecem listados (ver abaixo). Envie também de 1 a 10 documentos de origem
   em PDF/JPG/PNG/WEBP (até 20 MB cada).
2. Clique em **Analisar documentos** — habilitado apenas com um modelo válido.
   A IA extrai os valores dos documentos para os campos detectados.
3. **Página de revisão (`/revisao`)** — confira e corrija cada campo. A tela
   sinaliza campos em branco, CPF/CNPJ inválidos, CEP fora do padrão, conflitos
   entre documentos e dados não encontrados. Campos obrigatórios bloqueiam a
   geração.
4. Clique em **Pré-visualizar contrato** para ver o resultado em HTML e então
   **Baixar .docx**.

### Formato do modelo: `.docx` e `.doc`

O pipeline trabalha sobre OOXML, então o modelo precisa ser um `.docx`. Um `.doc`
legado (Word 97-2003) é um binário OLE2 completamente diferente — mas ele é
**convertido automaticamente** no servidor, via LibreOffice headless, e o
usuário nem percebe: os marcadores `{{CAMPO}}` e o texto em vermelho sobrevivem
à conversão.

A conversão exige o binário `soffice` no ambiente (ver
[Implantação](#implantação)). Onde ele não existe, o aplicativo mostra um aviso
discreto e recusa `.doc` com a instrução de salvar como `.docx` no Word.

### Implantação

Produção roda em container Docker. A imagem precisa do LibreOffice para a
conversão de `.doc`:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer \
 && rm -rf /var/lib/apt/lists/*
```

`libreoffice-writer` basta — não é preciso a suíte inteira. O caminho do binário
pode ser sobrescrito com `LIBREOFFICE_BIN` (padrão: `soffice`).

O [Dockerfile](Dockerfile) na raiz já faz isso: instala o `libreoffice-writer`,
builda com `NITRO_PRESET=node-server` e sobe `node .output/server/index.mjs` na
porta 3000. A `OPENAI_API_KEY` deve ser injetada como secret em tempo de
execução — nunca copiada para dentro da imagem.

### Como marcar campos no modelo Word

O detector aceita duas formas de marcação, que podem coexistir no mesmo modelo:

- **Placeholders** no formato `{{NOME_DO_CAMPO}}`;
- **Texto em vermelho** (`FF0000`, `C00000`, `ED1C24`, `E81123`, `DC143C`) — o
  próprio texto do trecho vira o nome do campo.

Se nenhum dos dois for encontrado, a análise falha com uma mensagem explicando
as marcações aceitas.

### Validação do modelo no upload

Assim que o modelo é enviado, ele passa por uma análise estrutural. **Erros
bloqueiam e o arquivo é descartado** — é preciso corrigir no Word e enviar de
novo. Avisos apenas informam.

| Problema                                                       | Severidade | Por quê                                                                                                            |
| -------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------ |
| Nenhum campo variável encontrado                               | Erro       | Não há o que preencher                                                                                             |
| Marcador com chaves incompletas (`{{CAMPO}`, `{CAMPO}`)        | Erro       | Sai literal no contrato final, sem aviso nenhum                                                                    |
| Marcador sem nome (`{{}}`)                                     | Erro       | Campo impossível de identificar                                                                                    |
| Mesmo campo com grafias diferentes (`{{SOCIO}}` e `{{SÓCIO}}`) | Erro       | Cada campo precisa de um nome canônico único, senão qualquer busca por nome de campo encontra grafias concorrentes |
| Espaços irregulares no nome (`{{PORTE_ DA_ EMPRESA}}`)         | Aviso      | Funciona, mas atrapalha o reconhecimento automático do tipo                                                        |
| Campo em vermelho que é só rótulo (`Bairro`, `CEP`, `Nº`…)     | Aviso      | Será preenchido só com o dado puro, sem repetir o rótulo                                                           |

Os erros aparecem em um painel logo abaixo dos uploads e os avisos num painel
menor, abaixo e à esquerda; ambos acompanhados de um toast.

## Privacidade

Os arquivos trafegam em base64, são processados em memória no servidor e não são
persistidos **por esta aplicação**. Eles são, porém, enviados à OpenAI para a
leitura — o que significa que documentos com dado pessoal (CPF, RG, CNH,
endereço) saem da sua infraestrutura. Vale conferir a política de retenção da sua
conta e, se o caso exigir, contratar zero data retention.

O estado intermediário entre as duas páginas fica em `sessionStorage` do
navegador, sob a chave `gaulke:contrato:estado`.

A `OPENAI_API_KEY` é lida apenas no servidor e nunca chega ao navegador.
