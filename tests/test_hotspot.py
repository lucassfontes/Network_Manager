"""Testes de hotspot simulados: sem mudar redes de verdade."""
import unittest
from unittest.mock import patch
from fastapi import HTTPException
from app import main

class HotspotTests(unittest.TestCase):
    def setUp(self):
        self.previous = main.TOKEN
        main.TOKEN = 'token-teste-aleatorio-com-mais-24-caracteres'

    def tearDown(self):
        main.TOKEN = self.previous

    def example(self):
        return main.Hotspot(device='wlp5s0', ssid='Minha Rede', password='SenhaSegura123')

    def test_creates_explicit_wifi_ap_profile(self):
        calls = []
        def fake(*args, **kwargs):
            calls.append(args)
            return 'wlp5s0:wifi\n' if 'status' in args else 'OK'
        with patch.object(main,'cmd',side_effect=fake):
            result=main.hotspot(self.example(),x_panel_token='token-teste-aleatorio-com-mais-24-caracteres')
        self.assertIn('connection',result)
        self.assertEqual(len(calls),4)
        _,add,modify,up=calls
        self.assertEqual(add[:5],('nmcli','connection','add','type','wifi'))
        self.assertEqual(modify[modify.index('802-11-wireless.mode')+1],'ap')
        self.assertEqual(modify[modify.index('ipv4.method')+1],'shared')
        self.assertEqual(modify[modify.index('802-11-wireless-security.key-mgmt')+1],'wpa-psk')
        self.assertEqual(up[1:5],('--wait','30','connection','up'))

    def test_failure_cleans_only_new_profile(self):
        calls=[]
        def fake(*args,**kwargs):
            calls.append(args)
            if 'status' in args:return 'wlp5s0:wifi\n'
            if 'up' in args: raise HTTPException(400,'Hotspot nao suportado')
            return 'OK'
        with patch.object(main,'cmd',side_effect=fake):
            with self.assertRaises(HTTPException): main.hotspot(self.example(),x_panel_token='token-teste-aleatorio-com-mais-24-caracteres')
        self.assertEqual(len(calls),5)
        self.assertEqual(calls[-1][1:4],('connection','delete','id'))
        self.assertEqual(calls[-1][-1],calls[1][calls[1].index('con-name')+1])

    def test_invalid_token_cannot_change_network(self):
        with patch.object(main,'cmd') as fake:
            with self.assertRaises(HTTPException) as err:
                main.hotspot(self.example(),x_panel_token='incorreto')
        self.assertEqual(err.exception.status_code,401)
        fake.assert_not_called()

    def test_utf8_ssid_limit(self):
        with patch.object(main,'cmd',return_value='wlp5s0:wifi\n') as fake:
            with self.assertRaises(HTTPException) as err:
                main.hotspot(main.Hotspot(device='wlp5s0',ssid='a'*31+'é',password='senha1234'),x_panel_token='token-teste-aleatorio-com-mais-24-caracteres')
        self.assertEqual(err.exception.status_code,400)
        self.assertEqual(fake.call_count,1)

if __name__=='__main__':unittest.main()
