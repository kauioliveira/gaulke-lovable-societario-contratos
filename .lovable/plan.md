## Objetivo
Adicionar, na tela de revisão (`src/routes/revisao.tsx`), um seletor manual para escolher o tipo de documento de identidade do sócio antes de gerar o contrato — sobrescrevendo o meta-campo `__META_TIPO_DOC_IDENTIDADE__` detectado pela IA.

## Mudanças

**`src/routes/revisao.tsx`**
- Novo estado `tipoDocIdentidade: "CNH" | "RG"`.
- Inicializar a partir de `estado.extracao.valores["__META_TIPO_DOC_IDENTIDADE__"]` (default: `"RG"` se ausente).
- Adicionar bloco de UI no painel de campos (acima de "Campos do contrato"), com `RadioGroup` (já existe em `src/components/ui/radio-group.tsx`) com duas opções:
  - "Carteira de Identidade (RG)" → `RG`
  - "Carteira Nacional de Habilitação (CNH)" → `CNH`
- No `mutationFn`, ao montar `valoresFinais`, forçar:
  ```
  valoresFinais["__META_TIPO_DOC_IDENTIDADE__"] = tipoDocIdentidade
  ```
  (sobrescrevendo o valor vindo da IA).

## Fora do escopo
- Não alterar `contratos.server.ts` — a lógica de substituição do trecho do preâmbulo já lê esse meta-campo e troca por "Carteira Nacional de Habilitação" ou "Carteira de Identidade" conforme o valor.
- Sem mudanças em formatadores ou no prompt da IA.

## Validação
- Build/typecheck automático.
- Verificar visualmente que o seletor aparece e que o valor escolhido prevalece sobre o detectado.
