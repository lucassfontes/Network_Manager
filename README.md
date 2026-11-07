# ZimaOS Network Manager — v0.3.13

Painel web de rede para **Linux / NetworkManager** (Zorin OS e ZimaOS). Menu lateral, Wi-Fi, hotspot, compartilhamento e edição de IP para conexões ativas. Sem suporte a Windows.

## Novo na v0.3.13

- **IP da conexão ativa:** DHCP ou IPv4 estático com endereço/prefixo, gateway e DNS em Wi-Fi ou Ethernet. IPv6 pode ser mantido, configurado automaticamente, definido manualmente ou desativado.
- **Hotspot ativo:** edição do endereço IPv4 da interface em modo compartilhado; o intervalo DHCP dos clientes não é configurável nesta versão.
- **Proteção de acesso:** ao aplicar, salva a configuração anterior e aguarda até **150 segundos** para confirmar. Sem confirmação ou em caso de falha, **tenta** restaurar o perfil antigo automaticamente. Essa restauração não é garantida em toda falha de rede; **faça o primeiro teste com acesso físico ao servidor**, nunca apenas remotamente.
- A edição exige uma conexão NetworkManager **ativa**. Não edita perfis desconectados. Alterações feitas por DHCP no roteador não são controladas pelo aplicativo.

- **Primeiro acesso:** crie um usuário e senha diretamente pelo navegador (mínimo 6 caracteres). Para impedir que outra pessoa registre a conta antes de você, o cadastro exige um código **de uso único** exibido no log do contêiner na primeira inicialização.
- **Login:** sessões de até 90 dias, renovadas durante uso, por cookie HttpOnly com SameSite Strict. A senha é protegida com PBKDF2-HMAC-SHA256 e sal aleatório; sessões são armazenadas como hashes no SQLite.
- **Persistência:** a conta, as sessões e o código inicial não ficam dentro do contêiner descartável. São salvos em `/app/data` e montados no host.
- **Wi-Fi:** clique sobre uma rede: abre a janela interna para informar a senha e conectar. Redes conectadas exibem **Desconectar**; não afeta hotspots via o botão de rede comum.
- **Minha conta:** alterar senha, encerrar sessão. Ao mudar a senha, todas as sessões são revogadas.
- **Sem PANEL_TOKEN:** retire essa variável de ambiente do Compose anterior.
- Mensagens do próprio aplicativo, sem caixas `alert()` ou `confirm()` do navegador.

## Instalação no ZimaOS

1. Envie a v0.3.13 ao GitHub, inclusive `.github/workflows/publicar-imagem.yml`.
2. Em Actions, aguarde a publicação da imagem no GHCR como `ghcr.io/lucassfontes/zimaos-network-manager-linux:0.3.13`, depois deixe o package público.
3. Importe o Compose em `deploy/zimaos-compose.yaml` na tela de aplicativo personalizado do ZimaOS.
4. Confirme que o volume `/DATA/AppData/ZimaOSNetworkManager/config:/app/data` existe/pode ser gravado; o Docker normalmente cria a pasta. **Não apague a pasta ao atualizar**, pois ela guarda a conta.
5. Abra `http://IP-DO-ZIMAOS:8687`. Se for a primeira instalação, abra os **logs do contêiner** no ZimaOS (ou execute `sudo docker logs --tail 40 zimaos-network-manager`) e copie o **código de instalação** mostrado; crie seu usuário e senha pelo formulário. Código de instalação não é um token de uso diário e é apagado depois do cadastro.
6. Faça login. Nesse navegador, a sessão é persistente. O botão **Sair** encerra apenas a sessão atual.

**Atualização da v0.3.10:** a configuração antiga `PANEL_TOKEN` e `PANEL_REQUIRE_READ_TOKEN` não é mais usada. Seu token antigo **não cria uma conta automaticamente**. Configure a conta uma vez. Verifique que o volume foi montado antes de criar a conta.

## Instalação no Zorin OS

Extraia o ZIP e execute `./iniciar.sh` (o terminal permanece aberto e mostra `http://localhost:8080`). A pasta `./data` guarda a conta. Para parar, use `./parar.sh`.

## Segurança e limitações

- O contêiner controla a rede do **host** usando D-Bus com AppArmor desabilitado **somente dentro do contêiner**, reduzindo o isolamento. O Docker rodando como root também aumenta o risco.
- **Não exponha 8687 à internet.** O Compose utiliza HTTP simples, adequado somente em LAN confiável. Para acesso remoto utilize túnel/VPN com HTTPS. Cookies podem ser capturados em redes hostis se não houver TLS; com HTTPS via proxy, configure `PANEL_SECURE_COOKIE=1`.
- **Primeiro acesso exige código impresso nos logs**; somente o administrador do ZimaOS/Docker deve ver esse código. Se esquecer a senha, não existe recuperação pela internet: salve um backup seguro da pasta `config` ou faça recuperação local com acesso administrativo.
- O hotspot pode derrubar o Wi-Fi atual; teste com acesso físico. O modo Wi-Fi + AP simultâneo ainda depende do driver.
- Editar DHCP, IPv4 estático e DNS em perfis ativos está implementado; a faixa DHCP do hotspot não é editável. O mecanismo de restauração é uma tentativa, não uma garantia.
- A v0.3.13 ainda precisa de testes de integração com hardware real e de publicação no GHCR.
