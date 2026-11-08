# Mosaico Vistas

[![Release](https://img.shields.io/github/v/release/graviscarduk/MosaicoVistas?label=release)](https://github.com/graviscarduk/MosaicoVistas/releases/latest)
[![Licença](https://img.shields.io/github/license/graviscarduk/MosaicoVistas)](LICENSE)
[![Plataforma](https://img.shields.io/badge/plataforma-Windows%2010%2F11-0078D6)](#requisitos)

Aplicativo **portátil** para Windows que exibe câmeras de ruas em um mosaico, com
seleção por mapa.

Nada é instalado no computador: o app sobe um servidor local usando o runtime
Node.js incluído no pacote e abre a interface no seu navegador. Não abre portas
no firewall.

## Baixar e usar

1. Vá até a página de [**Releases**](https://github.com/graviscarduk/MosaicoVistas/releases/latest)
   e baixe o arquivo `Mosaico-Vistas-v*.zip`.
2. Extraia o ZIP **inteiro** para uma pasta (a Área de Trabalho serve).
3. Dê um duplo clique em **`Mosaico Vistas.vbs`**.
4. O navegador abre sozinho: escolha a região e as câmeras.
5. Ao fechar a última aba, o serviço se encerra sozinho.

Para encerrar manualmente, use **`Parar Mosaico.vbs`**.

> Se o Windows avisar que o arquivo veio da internet: clique com o botão direito
> no ZIP → **Propriedades** → **Desbloquear**, antes de extrair.

## Requisitos

- Windows 10 ou 11
- Chrome ou Edge

### Se o vídeo não aparecer

As câmeras do COR transmitem em **H.265 (HEVC)**. Para visualizar:

- Use Chrome ou Edge no Windows.
- Instale a extensão **HEVC** da Microsoft Store (aprox. US$ 1).
- Feche e reabra o navegador após instalar.

Firefox e Chrome no Linux não decodificam H.265 e não exibirão o vídeo.

## Estrutura do repositório

```
Mosaico Vistas.vbs      inicia o app (sem janela de console)
Parar Mosaico.vbs       encerra o app
app/server.mjs          servidor local + proxy das câmeras
app/public/             interface (seleção, mosaico, player)
app/config.json         configuração padrão
LEIA-ME.txt             instruções rápidas para o usuário final
build.ps1               monta o pacote portátil em dist/
.github/workflows/      build e publicação da release
```

O `node.exe` **não** é versionado: ele é baixado no momento do build e incluído
apenas no ZIP distribuído.

## Desenvolvimento

Requisitos: [Node.js](https://nodejs.org/) 20 ou superior.

```powershell
npm start          # sobe o servidor local em http://127.0.0.1:8787/
```

A interface fica em `app/public/` e o servidor em `app/server.mjs`. Após alterar,
reinicie o processo para aplicar.

### Gerar o pacote localmente

```powershell
# usa o node.exe da raiz do projeto (baixe o seu em nodejs.org/dist)
./build.ps1 -NodeExe "C:\caminho\para\node.exe"
```

O ZIP é gerado em `dist/Mosaico-Vistas-v<versão>.zip`.

### Publicar uma versão

1. Atualize a `version` no `package.json` e o `CHANGELOG.md`.
2. Crie e envie a tag:

```powershell
git tag v1.0.0
git push origin v1.0.0
```

O workflow do GitHub Actions baixa o `node.exe`, monta o pacote e publica a
release com o ZIP anexado automaticamente.

## Autor

Carlos Lourenço

## Licença

Este projeto está licenciado sob a [Licença MIT](LICENSE).

## Nota legal

Este projeto não permite uso comercial devido à falta de direitos sobre as
imagens utilizadas.
