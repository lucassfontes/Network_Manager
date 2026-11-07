# Histórico de versões

## v0.3.11 — 07/11/2026
- Primeiro acesso com usuário, senha e código de instalação de uso único nos logs Docker.
- Removido PANEL_TOKEN; sessões persistentes por cookie HttpOnly com SQLite em volume.
- Wi-Fi: clique na rede abre formulário interno de senha; rede conectada mostra Desconectar.
- Minha conta: encerrar sessão e alterar senha; proteção de leitura e escrita por autenticação.
- Compose do ZimaOS com `/DATA/AppData/ZimaOSNetworkManager/config:/app/data` e ícone preservado.

## v0.3.10 — 06/11/2026
- Corrigido repositório de publicação para `lucassfontes/Network_Manager`.
- Workflow de publicação GHCR agora executa em cada push na `main`, tags v* ou manualmente.
- Imagem padronizada: `ghcr.io/lucassfontes/zimaos-network-manager-linux:0.3.10`.
- Ícone x-casaos apontando para o SVG no repositório real.
- Versão sincronizada no painel, contêiner, scripts, README e testes.
- Mantidas as proteções de token e o comportamento de rede; sem alterações nas funções de hotspot.
- Projeto reorganizado para publicar no GitHub com `.gitignore`, `.dockerignore`, `.env.example`, e `VERSION` sincronizado.
- Workflow GitHub Actions para compilar/publicar imagem no GHCR (tag 0.3.10 e latest); necessita execução e imagem pública.
- Compose separado para instalar como aplicativo personalizado no ZimaOS com ícone azul Wi-Fi, metadados x-casaos e porta padrão 8687.
- Acesso ao painel ZimaOS pela LAN, exigindo token também em todas as consultas à API; bloqueia servidor sem configuração protegida.
- Servidor web agora aceita `PANEL_BIND_HOST`, `PANEL_PORT` e `PANEL_REQUIRE_READ_TOKEN`; Zorin continua local por padrão.
- Mantidos menus, mensagens internas, detecção de rede e operações Wi-Fi/hotspot. Instalação real no ZimaOS ainda não testada.

## v0.3.9 — 06/11/2026
- Preparação para publicar o projeto no GitHub e instalar pelo ZimaOS.
- Adicionados workflow GHCR, Compose para ZimaOS, metadados de aplicativo e ícone azul Wi-Fi.
- Acesso local por token no ZimaOS; substituído por usuário e senha na v0.3.11.

## v0.3.8 — 05/11/2026
- Todas as confirmações de ações de rede agora aparecem numa janela do próprio sistema, com nome da ação, Cancelar e Confirmar.
- Avisos de sucesso, validação e erro exibidos pelo painel com ícones e botão de fechar; mensagens de erro permanecem na tela até serem fechadas.
- Formulários Wi-Fi e hotspot usam validação própria, sem os balões automáticos do navegador.
- Confirmação acessível: foco inicial, retorno do foco, Escape para cancelar e navegação por teclado.
- Preserva as APIs de rede, autenticação por token, interface lateral e scripts de inicialização.
- Requer teste real no Zorin OS para confirmar a interação com NetworkManager.

## v0.3.7 — 05/11/2026
- Nova lista visual de hotspots ativos (inclusive os criados fora do aplicativo).
- Botão **Parar hotspot** para cada hotspot ativo, com confirmação e token administrativo obrigatório.
- API `GET /api/hotspots` e `POST /api/hotspot/stop`: identifica o perfil ativo por UUID e verifica se é Wi-Fi no modo AP antes de desligar.
- Desliga somente o perfil escolhido; não desconecta a placa inteira nem remove perfis salvos.
- Estado de hotspot na visão geral baseado na detecção de perfis AP em vez de nomes.
- Mantém versão nos scripts, interface, imagem Docker e arquivo ZIP.
- Testes com NetworkManager simulado; ainda necessita teste real em hardware Linux.

## v0.3.6 — 05/11/2026
- Base Docker fixada em Debian 12 Bookworm: nmcli 1.42.x em vez de 1.52.x do Debian 13, para evitar envio da propriedade `mac-address-denylist` desconhecida pelo NetworkManager 1.46 do Zorin.
- Imagem Docker identificada por versão; reconstrução e recriação do contêiner ao iniciar para impedir uso de imagem antiga.
- Mensagem de diagnóstico quando o erro de propriedade incompatível persistir.
- Scripts, versão exibida e arquivos do projeto atualizados para v0.3.6.
- Sem reiniciar o NetworkManager do host nem alterar a configuração da rede existente.
- Testes locais de código/sintaxe; imagem não compilada no Docker deste ambiente.

## v0.3.5 — 05/11/2026
- Novo caminho de criação do hotspot: perfil Wi-Fi explícito, modo AP, SSID, senha e IPv4 compartilhado.
- Remove somente perfis recém-criados quando a ativação falha.
- Valida comprimento real do SSID e da senha em bytes UTF-8.
- Não reinicia o NetworkManager do host.
- Testes simulados da criação e falha de hotspot.
- Ainda precisa de teste real com a placa Wi-Fi do Zorin.

## v0.3.4 — Interface gráfica e leitura simplificada de rede
- Novo painel responsivo com tema escuro, ícone azul de Wi-Fi, menu lateral e visão geral.
- Cards para dispositivos físicos; interfaces virtuais aparecem separadas, reduzindo a confusão entre placas e conexões do Docker.
- Wi-Fi com lista visual por SSID, intensidade do sinal e segurança; seleção da rede preenche o formulário.
- Hotspot, compartilhamento, diagnóstico e autorização organizados em telas específicas.
- Tela de endereços IPv4, IPv6, gateway e DNS em **modo leitura**; edição de IP/DHCP continua não implementada.
- API `/api/wifi` passa a oferecer redes estruturadas, mantendo `lines` para compatibilidade.
- API `/api/ip` fornece informações de endereçamento, sem autorizar alterações.
- Corrigido parsing de `nmcli` para respeitar separadores escapados (ex.: SSID com `:`).
- Mantém token obrigatório nas ações de escrita, acesso local em `127.0.0.1:8080`, inicializadores e ajuste anterior do AppArmor.
- Testes de API e estrutura HTML, scripts Bash, JavaScript e navegação em navegador com respostas simuladas (não testado no Docker físico do usuário).

## v0.3.3 — Compatibilidade com AppArmor e diagnóstico de NetworkManager
- `compose.yaml`: AppArmor sem confinamento exclusivamente para o contêiner, possibilitando acesso ao D-Bus do host onde `docker-default` impedia o `Hello`.
- `app/main.py`: rota de saúde `/api/health` que valida a comunicação com NetworkManager.
- `iniciar.sh`: verifica a comunicação real, imprime diagnósticos e libera a porta de versões anteriores reconhecidas.
- Nome do projeto Docker Compose estabilizado para facilitar futuras atualizações.
- Mantém terminal aberto, token, painel local e numeração de versão sincronizada.
- Nota de segurança: o contêiner tem menos isolamento AppArmor; AppArmor do host permanece ativo.

## v0.3.2 — Correção de instalação das dependências
- Corrigido `requirements.txt`, que continha `\n` literal em vez de uma quebra de linha entre as dependências.
- Adicionada verificação preventiva antes do build.
- Versionamento atualizado no painel, API e scripts.

## v0.3.1 — Permissões Docker e inicialização
- Solicita senha de administrador quando a conexão ao socket do Docker é recusada por falta de permissão.
- Mantém o terminal aberto e exibe http://localhost:8080 e o estado dos serviços.
- `parar.sh` utiliza a mesma estratégia de acesso quando necessário.
- Exibe versão 0.3.1 no painel e mantém o controle de versões nos arquivos.

## v0.3 — Protótipo de interface e detecção
- Interface HTML e rotas de dispositivos, Wi-Fi, hotspot e status.
- Uso em Linux com NetworkManager, com limitações de compatibilidade e segurança.

