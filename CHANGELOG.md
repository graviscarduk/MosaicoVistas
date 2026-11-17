# Changelog

Todas as mudanças relevantes deste projeto são registradas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [1.1.0] - 2026-11-13

### Adicionado

- Seletor de cidade no app: Rio de Janeiro, São Paulo, Madrid e Los Angeles. O
  seletor mostra só a cidade e a fonte; o modo (vídeo/foto) aparece no rótulo de
  cada câmera no mosaico.
- Camadas de provedores (`app/providers/`) com lista e modo de exibição por cidade.
- **Los Angeles em vídeo**: HLS (H.264) por câmera, com foto de reserva quando o
  stream está fora do ar. O servidor faz o proxy da playlist e dos segmentos,
  incluindo o `Referer` exigido pela Caltrans.
- Modo foto no mosaico, com atualização automática e sequência de quadros quando
  a fonte publica várias imagens (CET-SP).
- Busca por endereço ajustada ao país da cidade (CEP só no Brasil).
- Atribuição e link da fonte visíveis no seletor e no mosaico.

### Alterado

- O mosaico agora reaproveita tiles de vídeo (WebRTC ou HLS) **ou** de imagem sem
  reiniciar os que já estão na tela.
- O teste de câmeras do seletor reconhece os modos vídeo, HLS e foto.
- Madrid: a foto passou a ser conferida a cada ~25 s (antes carregava uma única
  vez). A fonte troca a imagem em intervalos que variam de dezenas de segundos a
  alguns minutos; o servidor só baixa a foto de novo quando ela muda
  (`HEAD` + `ETag`).
- Los Angeles: a foto de reserva é atualizada a cada 30 s, também revalidando
  por `ETag` antes de baixar.
- `config.json` guarda a cidade escolhida (`provider`); configurações antigas
  continuam funcionando e assumem o Rio de Janeiro.

### Observado

- Rio de Janeiro e Los Angeles têm vídeo público acessível sem cadastro. Em Los
  Angeles o stream varia por câmera (~metade no ar em cada momento), por isso a
  cidade mistura vídeo e foto. São Paulo e Madrid publicam apenas fotos.

## [1.0.0] - 2026-11-08

### Adicionado

- Primeira versão pública do **Mosaico Vistas**.
- Seleção de câmeras por mapa, com busca por região.
- Grade de mosaico com as câmeras escolhidas.
- Player WHEP com suporte a H.265/HEVC no Chrome e no Edge.
- Proxy local das transmissões, sem abrir portas no firewall.
- Persistência da configuração entre sessões.
- Pacote portátil para Windows com `node.exe` embutido.
- Build automatizado e publicação de release via GitHub Actions.
