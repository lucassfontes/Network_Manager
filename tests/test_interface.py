"""Testes da interface e parsing; execução sem acesso ao hardware."""
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import main

class InterfaceTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    def test_html_and_assets_return_without_networkmanager(self):
        html = self.client.get('/')
        self.assertEqual(html.status_code, 200)
        self.assertIn('NetworkManager', html.text)
        self.assertIn('page-devices', html.text)
        self.assertIn('page-ip', html.text)
        self.assertIn('activeHotspots', html.text)
        self.assertIn('Parar hotspot', self.client.get('/assets/app.js').text)
        self.assertNotIn('<pre id="deviceout"', html.text)
        self.assertEqual(self.client.get('/assets/app.css').status_code, 200)
        self.assertEqual(self.client.get('/assets/app.js').status_code, 200)
        self.assertEqual(self.client.get('/assets/icon.svg').status_code, 200)

    def test_parse_escaped_wifi_name(self):
        self.assertEqual(main.split_nmcli(r'*:Caf\:e WiFi:92:WPA2', 4), ['*', 'Caf:e WiFi', '92', 'WPA2'])
        with patch.object(main, 'cmd', return_value=r'*:Caf\:e WiFi:92:WPA2' + '\n' + ':Convidados:31:--\n'):
            result = self.client.get('/api/wifi')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['networks'][0]['ssid'], 'Caf:e WiFi')
        self.assertTrue(result.json()['networks'][0]['inUse'])

    def test_device_types_and_virtual_interfaces(self):
        with patch.object(main, 'cmd', return_value='wlp5s0:wifi:connected:Casa Wi-Fi\ndocker0:bridge:connected (externally):docker0\nenp6s0:ethernet:unavailable:\n'):
            result = self.client.get('/api/devices')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(len(result.json()), 3)
        self.assertEqual(result.json()[0]['type'], 'wifi')
        self.assertEqual(result.json()[1]['type'], 'bridge')

    def test_ip_is_readonly_and_returns_structured_data(self):
        response = ('IP4.ADDRESS[1]:                         192.168.1.42/24\n'
                    'IP4.GATEWAY:                            192.168.1.1\n'
                    'IP4.DNS[1]:                             1.1.1.1\n'
                    'IP6.ADDRESS[1]:                         fe80::1234/64\n')
        def fake_cmd(*args, **kwargs):
            return 'wlp5s0:wifi\n' if 'status' in args else response
        with patch.object(main, 'cmd', side_effect=fake_cmd):
            result = self.client.get('/api/ip?device=wlp5s0')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['ipv4'], ['192.168.1.42/24'])
        self.assertEqual(result.json()['dns'], ['1.1.1.1'])
        self.assertEqual(result.json()['gateway'], '192.168.1.1')

    def test_write_operations_still_require_token(self):
        response = self.client.post('/api/disconnect',json={'device':'wlp5s0'})
        self.assertEqual(response.status_code, 401)

if __name__ == '__main__': unittest.main()
