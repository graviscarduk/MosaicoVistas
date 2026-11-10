# Homologação

Esta pasta é a **versão de homologação** do Mosaico Vistas: é aqui que as
mudanças são desenvolvidas e testadas antes de chegarem à versão estável.

## Divisão das pastas

```
D:\Meus Documentos\Projeto Padrão\
├── Mosaico Vistas\              versão estável (branch main)
└── Mosaico Vistas - Homolog\    versão de testes (branch homolog)
```

As duas pastas são **worktrees do mesmo repositório Git**. Compartilham o
histórico, mas cada uma tem a sua branch e o seu `app/config.json` — mexer
em uma não afeta a outra.

## Portas

| Versão | Endereço |
|---|---|
| Estável | `http://127.0.0.1:8787/` |
| Homologação | `http://127.0.0.1:8788/` |

Assim dá para abrir as duas ao mesmo tempo e comparar lado a lado.

## Como rodar a homologação

Duplo clique em **`Mosaico Vistas (Homolog).vbs`**.

- Usa o `node.exe` da pasta, se existir (pacote portátil).
- Caso contrário, usa o Node.js instalado no Windows (`C:\Program Files\nodejs`).
- Para encerrar: **`Parar Mosaico.vbs`** desta mesma pasta.

## Fluxo de trabalho

1. Desenvolver e testar aqui (`branch homolog`).
2. `git add` + `git commit` na branch `homolog`.
3. Quando aprovado, mesclar em `main`:
   ```
   git -C "D:\Meus Documentos\Projeto Padrão\Mosaico Vistas" merge homolog
   ```
4. Gerar release apenas a partir de `main` (tag `v*`).

## Em teste nesta rodada

- Seletor de cidade (Rio, São Paulo, Madrid, Los Angeles).
- Camada `app/providers/`: cada cidade informa lista e modo de exibição.
- Mosaico com tiles de vídeo (WHEP) **e** de foto (com atualização automática).
- Busca por endereço por país e atribuição visível da fonte.

Como testar:

1. Abra `http://127.0.0.1:8788/`.
2. Troque a cidade no seletor e confira a lista e o raio.
3. Selecione câmeras e abra o mosaico.
4. Em São Paulo, a foto troca de quadro a cada ~1,5 s. Em Madrid e Los
   Angeles, a foto é atualizada a cada poucos minutos.

Observação: o vídeo do Rio depende de H.265 no navegador. No navegador
interno do OpenCode o ICE pode não fechar (sem UDP); valide o vídeo no
Chrome/Edge do Windows.

## Regra de ouro

Não editar `Mosaico Vistas\app\` enquanto a mudança estiver em teste.
A pasta estável só recebe código já validado, via merge.
