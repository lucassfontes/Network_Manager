"""Regressões da rota de saúde com subprocessos simulados (sem acessar o D-Bus)."""
import unittest
from unittest.mock import patch
from fastapi import HTTPException
from app import main

class HealthTests(unittest.TestCase):
    def test_health_success(self):
        with patch.object(main,'cmd',return_value='connected\n'):
            self.assertEqual(main.health(), {'ok': True, 'version': '0.3.10', 'networkManagerState': 'connected'})

    def test_apparmor_error_diagnostic(self):
        original='An AppArmor policy prevents this sender from sending this message to this recipient'
        with patch.object(main,'cmd',side_effect=HTTPException(400,original)):
            with self.assertRaises(HTTPException) as cm:
                main.health()
        self.assertEqual(cm.exception.status_code,503)
        self.assertIn('AppArmor bloqueou o D-Bus',cm.exception.detail)

if __name__ == '__main__': unittest.main()
