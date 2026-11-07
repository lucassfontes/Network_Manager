import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import auth_store, main

class AuthTestCase(unittest.TestCase):
    def setUp(self):
        main._login_attempts.clear()
        self.temp = tempfile.TemporaryDirectory()
        self.patch_data = patch.object(auth_store, 'DATA_DIR', Path(self.temp.name))
        self.patch_data.start()
        self.client = TestClient(main.app)

    def tearDown(self):
        self.client.close()
        self.patch_data.stop()
        self.temp.cleanup()

    def setup_account(self):
        code=auth_store.setup_code()
        result=self.client.post('/api/auth/setup',json={'username':'admin','password':'UmaSenhaForte-123456','pairingCode':code})
        self.assertEqual(result.status_code,200,result.text)
        self.csrf=result.json()['csrf']
        return result

    def secured_post(self,path,json=None):
        return self.client.post(path,json=json,headers={'X-CSRF-Token':self.csrf})
