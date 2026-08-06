# Regras de negócio

Regras jurídicas e de formatação pt-BR aplicadas na extração, na revisão e na
geração do contrato. Elas vivem em três lugares:

- **Prompt de sistema** — [src/lib/contratos.server.ts](src/lib/contratos.server.ts) (`extrairValoresViaIA`)
- **Formatadores/validadores** — [src/lib/formatters.ts](src/lib/formatters.ts)
- **Tela de revisão** — [src/routes/revisao.tsx](src/routes/revisao.tsx)

Alterar uma regra normalmente exige tocar em mais de um desses pontos.

## Princípios da extração

1. **Nunca inventar dados.** Sem evidência clara no documento, o campo volta
   vazio e entra em `faltantes`.
2. **Conflito não é decisão da IA.** Valores divergentes entre documentos vão
   para `conflitos`, com o valor e a fonte de cada um, para revisão humana.
3. **Rastreabilidade.** Todo valor traz a `fonte` (nome do arquivo) e um nível de
   `confianca` (`alta` / `media` / `baixa`).
4. CPF/CNPJ/CEP são devolvidos **apenas com dígitos**; datas em **ISO
   `AAAA-MM-DD`**. A formatação é responsabilidade do sistema, não do modelo.

## Objeto social (cláusula quarta)

Regra crítica — origem única:

- Extrair **sempre** do documento **REGIN** (Viabilidade / Consulta de
  Viabilidade / Protocolo REGIN / DBE que traga REGIN), da seção
  `DESCRIÇÃO DO OBJETO SOCIAL`.
- Copiar o texto **integral e literal** de todas as linhas até o próximo rótulo —
  sem resumir, reordenar, remover atividades ou acrescentar palavras.
- Ignorar códigos CNAE, cabeçalhos e o próprio rótulo.
- Devolver em minúsculas; o sistema aplica Title Case com preposições corretas
  (`tituloEnderecoObjeto`).
- **Sem REGIN anexado, o campo fica vazio** e o motivo entra em `faltantes` e
  `observacoes`. Nunca derivar objeto social de outros documentos.

## Endereços

Dois formatos distintos, escolhidos por `detectarTipo()`:

| Tipo                                   | Formato alvo                                                    | Função                      |
| -------------------------------------- | --------------------------------------------------------------- | --------------------------- |
| `enderecoSocio` (pessoa física)        | `rua Nome da Rua nº 100, sala 2, Bairro Nome, CEP 00.000-000`   | `formatarEnderecoSocio()`   |
| `enderecoEmpresa` (sede/matriz/filial) | `Rua Nome, nº 100, bairro Nome, Município - UF, CEP 00.000-000` | `formatarEnderecoEmpresa()` |

Convenções comuns:

- Tipo de logradouro em minúsculas (`rua`, `avenida`, `travessa`, `rodovia`,
  `estrada`, `alameda`); `nº` minúsculo; `CEP` e UF maiúsculos.
- Nomes próprios em Title Case com preposições minúsculas (`de`, `da`, `do`,
  `das`, `dos`, `e`, `em`, `na`, `no`, `com`, `para`, `por`…).
- CEP formatado como `00.000-000` dentro de endereços; o campo `cep` isolado usa
  `00000-000` (padrão validado na tela de revisão).
- No endereço do **sócio** não entram município nem UF — eles têm campos
  próprios.

`formatarEnderecoEmpresa()` faz o parsing por partes: extrai o CEP, detecta a UF
na última parte (aceitando sigla ou nome completo do estado, inclusive compostos
como "rio grande do sul"), separa logradouro + número da primeira parte e trata o
restante como bairro + cidade.

> **Exceção na geração:** o valor do campo de endereço da empresa é enviado
> **literalmente** como está na tela de revisão, sem reformatar — regra
> confirmada pelo usuário. Veja `revisao.tsx`, na montagem de `valoresFinais`.

## Placeholders-rótulo

O modelo Word costuma ter placeholders em vermelho cujo texto é apenas o **nome
do campo**, com o rótulo fixo já impresso antes dele no contrato. Repetir o
rótulo no valor duplica texto no documento final.

Campos afetados: `Bairro`, `Cep`/`CEP`, `Nº`/`Numero`/`Número`, `Rua`,
`Logradouro`, `Cidade`, `Município`, `UF`, `Estado`, `Endereço`, `Razão Social`,
`Nome Empresarial`, `Nome Fantasia`.

Nesses casos o valor deve conter **só o dado puro** (`Bairro` → `Sertãozinho`,
`Nº` → `380`, `UF` → `SC`). Havendo dúvida entre um placeholder unificado de
endereço e placeholders individuais, preencha **sempre os individuais** e deixe o
unificado vazio.

Duas redes de proteção no código:

- `removerRotuloRedundante()` — remove o rótulo repetido no início do valor
  (`"Cep CEP 89..."` → `"89..."`), até 4 passadas.
- `removerPalavrasDuplicadas()` — remove palavras consecutivas duplicadas
  ignorando caixa e acento, em qualquer campo textual, até estabilizar
  (`"bairro Bairro Colonial"` → `"bairro Colonial"`). **Não** é aplicada a
  campos puramente formatados (`cpf`, `cnpj`, `cep`, `telefone`, `moeda`,
  `data`, `numero`, `uf`).

## Caixa alta e negrito

`ehCampoEmpresaOuSocio()` identifica razão social / nome empresarial /
denominação social / sócio / sócia / nome do administrador. Para esses campos, na
geração:

- o valor vira **caixa alta** (`toLocaleUpperCase("pt-BR")`);
- o run recebe **negrito** (`<w:b/><w:bCs/>`), tanto na forma `{{TAG}}`
  (`forcarNegritoEmTags`) quanto no run vermelho (`substituirRunsVermelhos`).

A IA deve devolver o nome em Title Case correto — a caixa alta é aplicada pelo
sistema.

## Defaults

| Campo         | Valor padrão quando não há informação clara                               |
| ------------- | ------------------------------------------------------------------------- |
| Profissão     | `empresário(a)`                                                           |
| Nacionalidade | `brasileiro(a)`                                                           |
| Data atual    | Data de hoje em `America/Sao_Paulo` (sempre sobrescreve o que a IA achou) |

## Documento de identidade

A IA devolve o meta-campo `__META_TIPO_DOC_IDENTIDADE__` (`"CNH"`, `"RG"` ou
`""`). Na tela de revisão o usuário escolhe explicitamente entre RG e CNH, e essa
escolha **sobrescreve** a detecção automática.

Na geração, o preâmbulo do contrato é normalizado para:

| Valor | Texto no contrato                                                |
| ----- | ---------------------------------------------------------------- |
| `CNH` | `Carteira Nacional de Habilitação, nº`                           |
| `RG`  | `Carteira de Identidade, nº`                                     |
| vazio | `Carteira Nacional de Habilitação ou Carteira de Identidade, nº` |

## Estado civil e regime de bens

- Campo de estado civil vira um `Select` com: Solteiro(a), Casado(a),
  Divorciado(a), Viúvo(a), Separado(a) judicialmente, União estável.
- Se o valor contiver "casad", a seleção de **regime de bens** passa a ser
  obrigatória e bloqueia a geração enquanto estiver vazia.
- Opções: Comunhão parcial de bens, Comunhão universal de bens, Separação total
  de bens, Participação final nos aquestos.
- O regime escolhido é gravado no placeholder cujo nome case com
  `/regime.*bens/i`, se existir.

## Capital social e quotas por extenso

Sincronização automática na tela de revisão:

- capital social → `moedaPorExtenso()` (`"Dez mil reais"`, com centavos quando
  houver);
- quantidade de quotas → `quotasPorExtenso()` (`"Dez mil quotas"`).

Na geração:

- **Com** placeholder próprio de "por extenso": o numérico perde o prefixo
  `R$ ` (o modelo normalmente já traz `R$` fixo antes do campo) e o extenso vai
  no seu próprio placeholder.
- **Sem** placeholder de extenso: os dois são concatenados —
  `R$ 10.000,00 (Dez mil reais)`.

O conversor por extenso (`inteiroPorExtenso`) cobre até bilhões, com `cem` vs.
`cento` e concordância de singular/plural (`real`/`reais`, `quota`/`quotas`).

## Validações da tela de revisão

| Verificação                                         | Severidade | Efeito             |
| --------------------------------------------------- | ---------- | ------------------ |
| Campo em branco                                     | erro       | Bloqueia a geração |
| CPF inválido (`cpfValido`, dígitos verificadores)   | erro       | Bloqueia           |
| CNPJ inválido (`cnpjValido`, dígitos verificadores) | erro       | Bloqueia           |
| Regime de bens ausente com sócio casado             | erro       | Bloqueia           |
| CEP fora de `00000-000`                             | aviso      | Não bloqueia       |

Ambos os validadores rejeitam sequências de dígitos repetidos
(`111.111.111-11`).

O painel lateral ainda exibe, sem bloquear: `faltantes` e `conflitos`
reportados pela IA e o texto livre de `observacoes`.

## Detecção de tipo de campo

`detectarTipo(nome)` normaliza o nome do placeholder (sem acentos, minúsculo,
`_` e espaços colapsados) e resolve, nesta ordem de precedência:

`cnpj` → `cpf` → `cep` → `telefone` → `moeda` (capital social / valor da quota,
exceto "extenso") → `data` (nascimento, fundação, `data` isolado) →
`numero` / `bairro` / `cidade` / `uf` (rótulos isolados) → `tituloSimples`
(cidade/município/bairro dentro de nome composto) → `enderecoEmpresa` ou
`enderecoSocio` → `objeto` (objeto social / atividade) → `texto`.

A ordem importa: regras mais específicas vêm antes das genéricas. Ao adicionar um
tipo novo, insira-o na posição correta e trate-o também no `switch` de
`aplicarFormatacao()`.
