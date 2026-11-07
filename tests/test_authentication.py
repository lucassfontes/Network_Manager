"""Integration tests: credentials, CSRF, persistence, and no access before setup."""
import tempfile
from pathlib import Path
from unittest.mock import patch
from app import main, auth_store
from tests.auth_fixtures import AuthTestCase

class AuthenticationTests(AuthTestCase):
    def test_first_access_requires_pairing_code(self):
        state=self.client.get('/api/auth/state').json()
        self.assertTrue(state['setupRequired'])
        self.assertNotIn('code', str(state).lower())
        self.assertEqual(self.client.get('/api/devices').status_code,401)
        wrong=self.client.post('/api/auth/setup',json={'username':'admin','password':'UmaSenhaForte-123456','pairingCode':'codigo-errado'})
        self.assertEqual(wrong.status_code,400)
        self.setup_account()
        self.assertFalse(self.client.get('/api/auth/state').json()['setupRequired'])
        self.assertFalse((Path(self.temp.name)/'primeiro-acesso.txt').exists())

    def test_saved_session_and_password_hash(self):
        result=self.setup_account()
        text=(Path(self.temp.name)/'users.sqlite3').read_bytes()
        self.assertNotIn(b'UmaSenhaForte-123456',text)
        self.assertNotIn(result.json()['csrf'].encode(),text)
        session=self.client.get('/api/auth/session')
        self.assertEqual(session.status_code,200)
        self.assertEqual(session.json()['username'],'admin')
        self.assertEqual(self.client.get('/api/status').status_code in (200,400,503),True)

    def test_csrf_and_unauth_prevent_nm_access(self):
        with patch.object(main,'cmd') as cmd:
            no_login=self.client.post('/api/disconnect',json={'device':'wlp5s0'})
            self.assertEqual(no_login.status_code,401)
            cmd.assert_not_called()
            self.setup_account()
            no_csrf=self.client.post('/api/disconnect',json={'device':'wlp5s0'})
            self.assertEqual(no_csrf.status_code,403)
            cmd.assert_not_called()
            other_origin=self.client.post('/api/disconnect',json={'device':'wlp5s0'},headers={'Origin':'https://evil.invalid','X-CSRF-Token':self.csrf})
            self.assertEqual(other_origin.status_code,403)
            cmd.assert_not_called()

    def test_logout_revokes_cookie(self):
        self.setup_account()
        result=self.secured_post('/api/auth/logout')
        self.assertEqual(result.status_code,200)
        self.assertEqual(self.client.get('/api/devices').status_code,401)
        wrong=self.client.post('/api/auth/login',json={'username':'admin','password':'SenhaErrada'})
        self.assertEqual(wrong.status_code,401)
        good=self.client.post('/api/auth/login',json={'username':'admin','password':'UmaSenhaForte-123456'})
        self.assertEqual(good.status_code,200)

    def test_password_change_revokes_sessions(self):
        self.setup_account()
        result=self.secured_post('/api/auth/change-password',{'currentPassword':'UmaSenhaForte-123456','newPassword':'NovaSenhaSegura-7654321'})
        self.assertEqual(result.status_code,200)
        self.assertEqual(self.client.get('/api/auth/session').status_code,401)
        self.assertEqual(self.client.post('/api/auth/login',json={'username':'admin','password':'UmaSenhaForte-123456'}).status_code,401)
        self.assertEqual(self.client.post('/api/auth/login',json={'username':'admin','password':'NovaSenhaSegura-7654321'}).status_code,200)

    def test_server_data_persists_across_connections(self):
        self.setup_account()
        token=self.client.cookies.get(auth_store.COOKIE_NAME)
        self.assertIsNotNone(token)
        self.assertTrue(auth_store.get_session_with_csrf(token))
        with patch.object(auth_store,'DATA_DIR',Path(self.temp.name)):
            self.assertTrue(auth_store.has_user())
            self.assertTrue(auth_store.get_session_with_csrf(token))

    def test_setup_once_only(self):
        self.setup_account()
        second=self.client.post('/api/auth/setup',json={'username':'another','password':'OutraSenhaSegura-234','pairingCode':'qualquercodigo'})
        self.assertEqual(second.status_code,409)

if __name__ == '__main__':
    import unittest;unittest.main()
