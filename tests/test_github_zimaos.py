"""Testes de autenticacao e empacotamento, sem usar rede real."""
import os
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml
from fastapi.testclient import TestClient
from app import main, server

ROOT = Path(__file__).resolve().parents[1]
SECRET = 'Um-token-seguro-de-exemplo-com-40-caracteres'

class ZimaOSDeploymentTests(unittest.TestCase):
    def test_lan_get_requires_valid_token_and_config_is_public(self):
        client = TestClient(main.app)
        with patch.object(main, 'REQUIRE_READ_TOKEN', True), patch.object(main, 'TOKEN', SECRET):
            cfg = client.get('/api/config')
            self.assertEqual(cfg.status_code, 200)
            self.assertTrue(cfg.json()['readRequiresToken'])
            for url in ('/api/devices', '/api/health', '/api/ip?device=wlp5s0', '/api/hotspots'):
                self.assertEqual(client.get(url).status_code, 401)
            with patch.object(main, 'cmd', return_value='connected'):
                health = client.get('/api/health', headers={'X-Panel-Token': SECRET})
                self.assertEqual(health.status_code, 200)
                self.assertEqual(health.json()['version'], '0.3.9')
            self.assertEqual(client.get('/api/health', headers={'X-Panel-Token': 'errado'}).status_code, 401)

    def test_placeholder_token_rejected_even_if_long(self):
        with patch.object(main, 'TOKEN', 'SUBSTITUA_POR_TOKEN_ALEATORIO_FORTE'):
            self.assertFalse(main.token_is_secure())
        with patch.object(main, 'TOKEN', SECRET):
            self.assertTrue(main.token_is_secure())

    def test_server_refuses_lan_without_auth_or_token(self):
        env = {'PANEL_BIND_HOST': '0.0.0.0', 'PANEL_PORT': '8687', 'PANEL_REQUIRE_READ_TOKEN': '0'}
        with patch.dict(os.environ, env):
            with self.assertRaises(SystemExit): server.main()
        env['PANEL_REQUIRE_READ_TOKEN'] = '1'
        with patch.dict(os.environ, env), patch.object(main, 'TOKEN', 'SUBSTITUA_POR_TOKEN_ALEATORIO_FORTE'):
            with self.assertRaises(SystemExit): server.main()
        with patch.dict(os.environ, env), patch.object(main, 'TOKEN', SECRET), patch.object(server.uvicorn, 'run') as run:
            server.main()
        run.assert_called_once()
        self.assertEqual(run.call_args.kwargs['host'], '0.0.0.0')
        self.assertEqual(run.call_args.kwargs['port'], 8687)

    def test_compose_and_version(self):
        root = yaml.safe_load((ROOT / 'compose.yaml').read_text())
        zima = yaml.safe_load((ROOT / 'deploy/zimaos-compose.yaml').read_text())
        self.assertEqual(root['services']['network-panel']['network_mode'], 'host')
        svc = zima['services']['network-panel']
        self.assertEqual(svc['environment']['PANEL_REQUIRE_READ_TOKEN'], '1')
        self.assertEqual(svc['environment']['PANEL_BIND_HOST'], '0.0.0.0')
        self.assertEqual(svc['environment']['PANEL_PORT'], '8687')
        self.assertIn(':0.3.9', svc['image'])
        self.assertEqual(zima['x-casaos']['port_map'], '8687')
        self.assertEqual((ROOT / 'VERSION').read_text().strip(), '0.3.9')
        self.assertIn('0.3.9', (ROOT / '.github/workflows/publicar-imagem.yml').read_text() + (ROOT / 'VERSION').read_text())
        self.assertIn('.env', (ROOT / '.gitignore').read_text())

if __name__ == '__main__': unittest.main()
