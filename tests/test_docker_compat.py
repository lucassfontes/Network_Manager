"""Regressões para a imagem Docker e tratamento da incompatibilidade."""
from pathlib import Path
import unittest
from unittest.mock import patch
from fastapi import HTTPException
from app import main

ROOT = Path(__file__).resolve().parents[1]

class DockerCompatibilityTests(unittest.TestCase):
    def test_pins_debian_bookworm_to_avoid_new_nmcli_property(self):
        dockerfile = (ROOT / 'Dockerfile').read_text()
        compose = (ROOT / 'compose.yaml').read_text()
        start = (ROOT / 'iniciar.sh').read_text()
        self.assertIn('FROM python:3.12-slim-bookworm', dockerfile)
        self.assertIn('image: zimaos-network-manager:0.3.9', compose)
        self.assertIn('compose up --build --force-recreate -d', start)

    def test_incompatible_property_has_actionable_diagnostic(self):
        def failing(*args, **kwargs):
            if 'status' in args:
                return 'wlp5s0:wifi\n'
            if 'connection' in args and 'add' in args:
                raise HTTPException(400, '802-11-wireless.mac-address-denylist: propriedade desconhecida')
            return 'OK'
        previous = main.TOKEN
        main.TOKEN = 'teste-aleatorio-com-mais-24-caracteres'
        try:
            with patch.object(main, 'cmd', side_effect=failing):
                with self.assertRaises(HTTPException) as cm:
                    main.hotspot(main.Hotspot(device='wlp5s0',ssid='MinhaRede',password='Senha123456'),x_panel_token='teste-aleatorio-com-mais-24-caracteres')
            self.assertEqual(cm.exception.status_code, 503)
            self.assertIn('v0.3.9', cm.exception.detail)
        finally:
            main.TOKEN = previous

if __name__ == '__main__': unittest.main()
