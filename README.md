# ZimaOS Network Manager — v0.3.9

Painel web de redes Wi-Fi, Ethernet, hotspot e status do NetworkManager em **Linux**. Interface visual com menu lateral, mensagens internas, listagem de hotspots ativos e opção de pará-los. **Não é um gerenciador de IP estático/DHCP:** a tela IP continua em modo de leitura.

> Atenção: esse contêiner controla a rede **do host** via D-Bus. Pode desconectar o servidor e a pessoa que está acessando remotamente. Não exponha a porta à internet. Use em rede local confiável ou VPN com HTTPS. O AppArmor é desabilitado *somente para esse contêiner*, reduzindo seu isolamento. Teste primeiro com acesso físico ao equipamento.

## Instalar no Zorin OS, diretamente do GitHub

Após publicar o repositório:

```bash
git clone https://github.com/lucassfontes/ZimaOS-Network-Manager-Linux.git
cd ZimaOS-Network-Manager-Linux
chmod +x iniciar.sh parar.sh
./iniciar.sh
```

O script cria um token forte em `.env` se ele não existir, pede `sudo` se o Docker exigir, reconstrói a imagem e mantém o terminal aberto. Abrir **http://localhost:8080**. `./parar.sh` interrompe o contêiner. Docker Engine e `docker compose` devem estar instalados; requer Python 3 para gerar o token. Não adicione `.env` ao GitHub.

## Instalar diretamente na interface do ZimaOS (imagem GHCR)

1. Publique os arquivos deste projeto em um repositório público com o nome **`lucassfontes/ZimaOS-Network-Manager-Linux`** (ou ajuste os caminhos de imagem e ícone no Compose).
2. Em GitHub, abra **Actions → Publicar imagem Docker no GHCR → Run workflow**. Aguarde o workflow publicar a imagem `ghcr.io/lucassfontes/zimaos-network-manager-linux:0.3.9`.
3. **Faça o pacote GHCR ficar público:** GitHub → Packages → imagem publicada → Package settings → Change visibility → Public. Sem isso, o ZimaOS pode receber erro `denied` ao fazer `pull`.
4. Abra `deploy/zimaos-compose.yaml` e **troque o `PANEL_TOKEN` pelo seu próprio segredo aleatório com 24+ caracteres**. Por exemplo, gere no Linux com `openssl rand -hex 24`. Nunca publique seu Compose preenchido com o token.
5. No ZimaOS: **Apps / App Center → Instalar aplicativo personalizado → Importar Compose** e cole o conteúdo do arquivo `deploy/zimaos-compose.yaml`, já com seu token. Verifique a imagem e instale.
6. Acesse **`http://IP-DO-ZIMAOS:8687`** na sua rede local. Informe o mesmo token em **Acesso administrativo** antes de consultar os dados ou mudar conexões.

O exemplo usa a porta **8687** para reduzir o risco de colisão com apps que usam 8080. Se a porta estiver ocupada, altere **PANEL_PORT** e **x-casaos.port_map** juntos. O IP é o do seu ZimaOS, não `localhost` no celular.

**Importante:** o exemplo é uma *instalação personalizada*, não uma publicação automática na loja oficial do ZimaOS. A funcionalidade depende de NetworkManager e acesso D-Bus compatível no host. A criação/encerramento de hotspot não foi validada no seu hardware ZimaOS.

## Como publicar o GitHub sem perder o controle de versão

Para colocar os arquivos no repositório vazio a partir de um PC Linux:

```bash
git init
git add .
git commit -m "ZimaOS Network Manager v0.3.9"
git branch -M main
git remote add origin https://github.com/lucassfontes/ZimaOS-Network-Manager-Linux.git
git push -u origin main
```

Se publicar pelo navegador, **extraia o ZIP** e envie as pastas/arquivos, inclusive `.github/workflows/`. O ZIP inteiro enviado como anexo ao GitHub não é um repositório funcional. A pasta `.github` é oculta em alguns gerenciadores de arquivos.

## Diagnóstico e segurança

- `/api/health` testa o acesso ao NetworkManager; na instalação ZimaOS, precisa do cabeçalho `X-Panel-Token`.
- Configurações de Wi-Fi e hotspot persistem no NetworkManager **do Linux host**, não dentro do contêiner. O token do Zorin fica no `.env`; o do ZimaOS está no Compose privado do usuário.
- Não configurar redirecionamento de porta no roteador. HTTP puro não protege o token de interceptação em redes não confiáveis. Prefira VPN ou proxy HTTPS para uso remoto.
- Se o host não usar NetworkManager ou bloquear D-Bus/Polkit, este contêiner não poderá controlar a rede. `network_mode: host` e o socket D-Bus são necessários para o funcionamento pretendido, mas dão privilégios sensíveis.
- A versão do `nmcli` no contêiner vem do Debian 12 (série 1.42); não significa compatibilidade garantida com qualquer NetworkManager do host.
- O `compose.yaml` da raiz é para desenvolvimento/instalação pelo GitHub com build local (porta 8080 local). O **`deploy/zimaos-compose.yaml`** é para importar no ZimaOS e baixar a imagem do GHCR (porta 8687 na rede, com token obrigatório também para consulta).
- **Não foi realizado teste Docker real nesta máquina**. Tests unitários/simulados não substituem teste no Zorin/ZimaOS.
