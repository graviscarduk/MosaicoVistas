# Mosaico Vistas

[![Release](https://img.shields.io/github/v/release/graviscarduk/MosaicoVistas?label=release)](https://github.com/graviscarduk/MosaicoVistas/releases/latest)
[![Licença](https://img.shields.io/github/license/graviscarduk/MosaicoVistas)](LICENSE)
[![Plataforma](https://img.shields.io/badge/plataforma-Windows%2010%2F11-0078D6)](#requisitos)

Aplicativo **portátil** para Windows que exibe câmeras de ruas em um mosaico, com
seleção por mapa. Reúne câmeras de trânsito públicas de várias cidades: o Rio de
Janeiro transmite em vídeo (WebRTC/H.265) e Los Angeles em vídeo HLS (H.264) nas
câmeras em que o stream está no ar; São Paulo e Madrid publicam fotos atualizadas.

Nada é instalado no computador: o app sobe um servidor local usando o runtime
Node.js incluído no pacote e abre a interface no seu navegador. Não abre portas
no firewall.

## Baixar e usar

1. Vá até a página de [**Releases**](https://github.com/graviscarduk/MosaicoVistas/releases/latest)
   e baixe o arquivo `Mosaico-Vistas-v*.zip`.
2. Extraia o ZIP **inteiro** para uma pasta (a Área de Trabalho serve).
3. Dê um duplo clique em **`Mosaico Vistas.vbs`**.
4. O navegador abre sozinho: escolha a cidade, a região e as câmeras.
5. Ao fechar a última aba, o serviço se encerra sozinho.

Para encerrar manualmente, use **`Parar Mosaico.vbs`**.

> Se o Windows avisar que o arquivo veio da internet: clique com o botão direito
> no ZIP → **Propriedades** → **Desbloquear**, antes de extrair.

## Cidades disponíveis

| Cidade | Fonte | Modo |
|---|---|---|
| Rio de Janeiro | COR-Rio | **vídeo ao vivo** (WebRTC/WHEP, H.265) |
| Los Angeles | Caltrans (distrito 7) | **vídeo** HLS (H.264) quando disponível; foto a cada ~30 s como reserva |
| São Paulo | CET | fotos (sequência de ~1,1 s) |
| Madrid | Informo / Ayuntamiento | fotos (confere a cada ~25 s; a fonte publica em dezenas de segundos a minutos) |

A prioridade do projeto é **vídeo**. Rio e Los Angeles têm vídeo acessível sem
cadastro; em Los Angeles o stream de cada câmera entra e sai do ar, então a
mesma cidade mistura vídeo e foto. São Paulo e Madrid só publicam fotos.
Cidades como Curitiba, Porto Alegre, Fortaleza, Santos, Barcelona, Lisboa,
Buenos Aires e Santiago não mantêm um feed público de câmeras de trânsito.

As imagens pertencem às respectivas prefeituras/órgãos de trânsito. O app apenas
exibe o que já é público, mantém a atribuição na tela e não deve ser usado
comercialmente.

## Requisitos

- Windows 10 ou 11
- Chrome ou Edge

### Se o vídeo não aparecer

O Rio de Janeiro usa **H.265 (HEVC)**. Para visualizar:

- Use Chrome ou Edge no Windows.
- Instale a extensão **HEVC** da Microsoft Store (aprox. US$ 1).
- Feche e reabra o navegador após instalar.

Los Angeles usa H.264 e funciona nos navegadores comuns, sem extensão.

Firefox e Chrome no Linux não decodificam H.265 e não exibirão o vídeo do Rio.

## Estrutura do repositório

```
Mosaico Vistas.vbs      inicia o app (sem janela de console)
Parar Mosaico.vbs       encerra o app
app/server.mjs          servidor local + proxy das câmeras
app/providers/          fontes por cidade (lista e modo de exibição)
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

### Adicionar uma cidade

Cada cidade é um módulo em `app/providers/` com a interface:

```js
{
  id, label, attribution, creditUrl,
  kind,             // 'whep', 'hls' ou 'snapshot'
  mediaLabel,       // texto no seletor (ex.: 'vídeo (foto se fora do ar)')
  defaultCenter, defaultZoom, defaultRadiusKm, maxRadiusKm,
  imageHeaders,     // opcional: Referer exigido pela fonte de fotos
  hlsHosts,         // opcional: hosts permitidos no proxy de HLS
  hlsReferer,       // opcional: Referer exigido pela fonte de vídeo
  listCameras(),    // [{ id, nome, lat, lon }]
  stream(camera)    // { kind, url, refreshMs?, frames?, proxy?, revalidate? }
}
```

Registre o módulo em `app/providers/index.mjs`. O servidor expõe
`/api/providers`, `/api/cameras?provider=`, `/api/stream?provider=&id=`,
`/api/snapshot?provider=&id=&frame=` e `/api/hls?provider=&id=&u=`; a interface
se adapta ao `kind` de cada câmera. O proxy de HLS reescreve a playlist para que
playlist e segmentos passem pelo servidor local (resolve CORS e `Referer`).
Com `revalidate: true` no `stream()`, o servidor confere com um `HEAD` se a foto
mudou antes de baixá-la de novo (usa `ETag`/`Last-Modified`).

`app/public/vendor/hls.min.js` é o [hls.js](https://github.com/video-dev/hls.js)
(Apache-2.0), usado apenas para o vídeo HLS de Los Angeles.

### Gerar o pacote localmente

```powershell
./build.ps1
```

Por padrão usa o `node.exe` da raiz do projeto ou, se ele não existir, o Node.js
instalado na máquina. Para usar um binário específico:

```powershell
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
