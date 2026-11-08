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

## Regra de ouro

Não editar `Mosaico Vistas\app\` enquanto a mudança estiver em teste.
A pasta estável só recebe código já validado, via merge.
