"""GitHub and ZimaOS deployment checks for cookie-auth based version."""
import unittest
from pathlib import Path
import yaml
from app import main
from tests.auth_fixtures import AuthTestCase

ROOT=Path(__file__).resolve().parents[1]
class DeploymentTests(AuthTestCase):
    def test_lan_requires_login_to_read_private_network_info(self):
        self.assertEqual(self.client.get('/api/auth/state').status_code,200)
        for path in ('/api/devices','/api/health','/api/ip?device=wlp5s0','/api/hotspots'):
            self.assertEqual(self.client.get(path).status_code,401)
        self.setup_account()
        self.assertEqual(self.client.get('/api/auth/session').json()['username'],'admin')

    def test_compose_version_and_icons(self):
        root=yaml.safe_load((ROOT/'compose.yaml').read_text())
        zima=yaml.safe_load((ROOT/'deploy/zimaos-compose.yaml').read_text())
        self.assertEqual(root['services']['network-panel']['network_mode'],'host')
        svc=zima['services']['network-panel']
        self.assertEqual(svc['environment']['PANEL_BIND_HOST'],'0.0.0.0')
        self.assertEqual(svc['environment']['PANEL_PORT'],'8687')
        self.assertNotIn('PANEL_TOKEN',svc['environment'])
        self.assertIn('/DATA/AppData/ZimaOSNetworkManager/config:/app/data',svc['volumes'])
        self.assertEqual(zima['x-casaos']['version'],'0.3.11')
        self.assertEqual((ROOT/'VERSION').read_text().strip(),'0.3.11')
        self.assertEqual(zima['x-casaos']['icon'],'https://raw.githubusercontent.com/lucassfontes/Network_Manager/main/app/assets/icon.svg')
        self.assertEqual(svc['image'],'ghcr.io/lucassfontes/zimaos-network-manager-linux:0.3.11')
        workflow=(ROOT/'.github/workflows/publicar-imagem.yml').read_text()
        self.assertIn('docker/build-push-action@v6',workflow)
        self.assertIn('packages: write',workflow)
        self.assertIn('push: true',workflow)

if __name__=='__main__':unittest.main()
