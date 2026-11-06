"""Inicialização do painel; no ZimaOS permite acesso LAN sob autenticação."""
import os
import uvicorn

def main():
    host = os.getenv('PANEL_BIND_HOST', '127.0.0.1').strip()
    if host not in ('127.0.0.1', '0.0.0.0'):
        raise SystemExit('PANEL_BIND_HOST deve ser 127.0.0.1 ou 0.0.0.0')
    port = int(os.getenv('PANEL_PORT', '8080'))
    if not 1024 <= port <= 65535:
        raise SystemExit('PANEL_PORT deve estar entre 1024 e 65535')
    if host == '0.0.0.0':
        if os.getenv('PANEL_REQUIRE_READ_TOKEN') != '1':
            raise SystemExit('Acesso LAN exige PANEL_REQUIRE_READ_TOKEN=1; painel bloqueado.')
        from app.main import token_is_secure
        if not token_is_secure():
            raise SystemExit('Token fraco ou padrao. Configure PANEL_TOKEN forte antes de iniciar na LAN.')
    uvicorn.run('app.main:app', host=host, port=port, proxy_headers=False, server_header=False)

if __name__ == '__main__':
    main()
