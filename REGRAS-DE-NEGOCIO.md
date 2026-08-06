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
  (`tituloPtBr`).
- **Sem REGIN anexado, o campo fica vazio** e o motivo entra em `faltantes` e
  `observacoes`. Nunca derivar objeto social de outros documentos.

## Endereços

O endereço **não é extraído como uma linha pronta**. A IA devolve cada peça
separada, sob nomes sintéticos que não existem no Word
(`__ENDSOCIO_LOGRADOURO__`, `__ENDEMPRESA_CEP__`…), a tela de revisão mostra um
campo por peça, e só na geração a linha é montada e gravada no marcador composto
do modelo.

Isso existe para permitir **conferir e validar peça por peça** — CEP no padrão,
UF entre as 27 siglas, número presente — em vez de aprovar um texto corrido. Se a
IA devolver só a linha inteira, `decomporEndereco()` a quebra nas peças como rede
de segurança.

O logradouro vem com o **tipo por extenso**: documentos abreviam
("R LEONARDO KRAINSKI") e o prompt manda expandir para "Rua Leonardo Krainski".

Dois formatos distintos na montagem, escolhidos por `detectarTipo()`:

| Tipo                                   | Formato alvo                                                    | Função                    |
| -------------------------------------- | --------------------------------------------------------------- | ------------------------- |
| `enderecoSocio` (pessoa física)        | `rua Nome da Rua nº 100, sala 2, Bairro Nome, CEP 00.000-000`   | `montarEnderecoSocio()`   |
| `enderecoEmpresa` (sede/matriz/filial) | `Rua Nome, nº 100, bairro Nome, Município - UF, CEP 00.000-000` | `montarEnderecoEmpresa()` |

Convenções comuns:

- Tipo de logradouro em minúsculas (`rua`, `avenida`, `travessa`, `rodovia`,
  `estrada`, `alameda`); `nº` minúsculo; `CEP` e UF maiúsculos.
- Nomes próprios em Title Case com preposições minúsculas (`de`, `da`, `do`,
  `das`, `dos`, `e`, `em`, `na`, `no`, `com`, `para`, `por`…).
- CEP formatado como `00.000-000` dentro de endereços; o campo `cep` isolado usa
  `00000-000` (padrão validado na tela de revisão).
- No endereço do **sócio** não entram município nem UF — eles têm campos
  próprios.

`decomporEndereco()` faz o parsing por partes: extrai o CEP (com o rótulo "CEP"
junto, se houver), detecta a UF na última parte (aceitando sigla ou nome completo
do estado, inclusive compostos como "rio grande do sul"), separa número e
complemento quando vêm como partes próprias, e remove rótulos escritos na linha
("bairro Centro" → "Centro").

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

O regime escolhido **precisa chegar ao contrato**. Como a maioria dos modelos não
tem marcador próprio para ele, o padrão é escrevê-lo junto ao estado civil:
`Casado(a)` vira **"casado sob o regime de comunhão parcial de bens"**, que é como
o contrato social redige. Havendo um marcador `{{REGIME_BENS}}` (ou
`REGIME_MATRIMONIAL`, `REGIME_CASAMENTO`), ele é usado no lugar.

- Campo de estado civil vira um `Select` com: Solteiro(a), Casado(a),
  Divorciado(a), Viúvo(a), Separado(a) judicialmente, União estável.
- Se o valor contiver "casad", a seleção de **regime de bens** passa a ser
  obrigatória e bloqueia a geração enquanto estiver vazia. O seletor aparece no
  **fim** da lista de campos, não no topo: ele só faz sentido depois que o
  estado civil foi conferido, e o estado civil está entre os campos.
- Trocar o estado civil para algo que não seja casado limpa o regime escolhido,
  para ele não vazar para o contrato.
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

## Caixa dos textos

`tituloPtBr()` normaliza texto para Title Case pt-BR: derruba tudo para minúsculo
e sobe só a inicial de cada palavra, mantendo em minúsculo as palavras de ligação
(`de`, `da`, `do`, `das`, `dos`, `e`, `em`, `na`, `no`, `sob`, `ao`, `à`…).

Aplicado nos tipos `nomeProprio` (razão social, sócio, administrador,
nacionalidade, profissão, porte), `cidade`, `bairro`, `tituloSimples` e `objeto`.

Três exceções deliberadas:

- **Siglas de UF** (`SC`, `SP`) ficam em caixa alta. Sem isso a cláusula de foro
  sairia "São Bento do Sul - Sc".
- **Siglas de tipo societário** (`LTDA`, `ME`, `EPP`, `EIRELI`) ficam em caixa alta.
- **Órgão expedidor** tem tipo próprio (`sigla`) e vai inteiro para caixa alta —
  Title Case transformaria `DETRAN/SC` em `Detran/Sc`.

O `&` separa palavras, senão `P&G` sairia `P&g`.

Isso é **normalização de tela**. Razão social e nome do sócio continuam saindo em
CAIXA ALTA e negrito no documento, aplicados por `ehCampoEmpresaOuSocio()` na
geração — praxe em contrato social.

## Nome canônico único por campo

Cada campo do modelo precisa ter **uma só grafia** em todo o documento.
Marcadores que significam a mesma coisa escritos de formas diferentes —
`{{SOCIO}}` e `{{SÓCIO}}`, `{{CIDADE_E_ESTADO}}` e `{{CIDADE E ESTADO}}` — são
detectados por `agruparGrafiasEquivalentes()` (mesma normalização de
`detectarTipo()`: sem acento, minúsculo, `_`/espaços colapsados) e **bloqueiam o
upload**.

O motivo é olhar para frente: qualquer processo que busque um campo pelo nome
(auditoria do contrato gerado, varredura em lote de modelos, mapeamento fixo de
campo → regra de formatação) encontra grafias concorrentes e falha ou escolhe a
errada. Padronizar no Word uma vez elimina a classe inteira de problema.

Como rede de segurança, a tela de revisão continua agrupando grafias
equivalentes num campo só e replicando o valor em todas elas na geração — de
modo que, se alguma escapar, o contrato nunca saia com textos divergentes para o
mesmo dado.

## Validações da tela de revisão

| Verificação                                         | Severidade | Efeito             |
| --------------------------------------------------- | ---------- | ------------------ |
| Campo em branco                                     | erro       | Bloqueia a geração |
| CPF inválido (`cpfValido`, dígitos verificadores)   | erro       | Bloqueia           |
| CNPJ inválido (`cnpjValido`, dígitos verificadores) | erro       | Bloqueia           |
| Regime de bens ausente com sócio casado             | erro       | Bloqueia           |
| Peça de endereço vazia (menos complemento)          | erro       | Bloqueia           |
| CEP fora de `00000-000`                             | aviso      | Não bloqueia       |
| UF fora do padrão de 2 letras                       | aviso      | Não bloqueia       |
| Nº de quotas ≠ capital social                       | aviso      | Não bloqueia       |

Ambos os validadores de documento rejeitam sequências de dígitos repetidos
(`111.111.111-11`).

**Quotas × capital** merece explicação: a cláusula do capital costuma dizer
"dividido em N quotas no valor de R$ 1,00". Quando é esse o caso, o número de
quotas tem que ser igual ao capital, senão o contrato sai com uma conta errada
sem ninguém perceber. É aviso e não bloqueio porque outro modelo pode adotar
valor unitário diferente.

Cada validação carrega um texto de **ajuda** (o "?" ao lado), dizendo onde o dado
costuma estar no documento e qual o formato esperado.

O painel lateral ainda exibe, sem bloquear:

- **`faltantes`** — o que a IA não encontrou. A lista é **reativa**: cada item
  some conforme o campo é preenchido à mão.
- **`conflitos`** — valores divergentes entre documentos, cada um com sua fonte.
- **`observacoes`** — texto livre da IA.
- Campos de **baixa confiança** ganham um selo "conferir" no formulário: a IA já
  reporta o quanto confia em cada leitura, e ignorar isso desperdiçava um sinal
  útil de para onde olhar. O selo some assim que o usuário sai do campo (já
  conferiu) e só reaparece se o campo for esvaziado.

## Detecção de tipo de campo

`detectarTipo(nome)` normaliza o nome do placeholder (sem acentos, minúsculo,
`_` e espaços colapsados) e resolve, nesta ordem de precedência:

**endereço composto** → `cnpj` → `cpf` → `cep` → `telefone` → `moeda` (capital
social / valor da quota, exceto "extenso") → `data` (nascimento, fundação, `data`
isolado, "data atual/hoje/corrente/emissão/geração") → `numero` / `bairro` /
`cidade` / `uf` (rótulos isolados) → `tituloSimples` (cidade/município/bairro
dentro de nome composto) → `enderecoEmpresa` ou `enderecoSocio` → `objeto`
(objeto social / atividade) → `texto`.

**Endereço composto vem primeiro** de propósito. Nomes de placeholder que
descrevem o endereço inteiro — como
`{{ENDEREÇO_COMPLETO_COM_RUA_NUMERO_BAIRRO_CEP}} `— citam vários componentes e
seriam capturados pela regra de `cep`, o que aplicaria `formatarCEP()` num
endereço inteiro e ainda reprovaria o campo na validação de CEP da tela de
revisão, bloqueando a geração. A regra dispara quando o nome contém
`endere`/`logradouro` **e** ao menos um de `completo`, `rua`, `numero`, `n`,
`bairro`, `cep`; a distinção sócio vs. empresa continua sendo feita por
`ehEnderecoDeEmpresa()` (`empresa|sede|estabelecim|matriz|filial`).

A ordem importa: regras mais específicas vêm antes das genéricas. Ao adicionar um
tipo novo, insira-o na posição correta e trate-o também no `switch` de
`aplicarFormatacao()`.
