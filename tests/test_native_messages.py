"""Regression tests for the app-owned confirmations and notifications."""
import re
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from app import main

ROOT = Path(__file__).resolve().parents[1]

class NativeMessageTests(unittest.TestCase):
    def test_browser_confirm_removed_and_panel_confirmation_available(self):
        js = (ROOT / 'app/assets/app.js').read_text()
        self.assertNotRegex(js, r'(?<![\w.])confirm\s*\(')
        self.assertIn('await panelConfirm(warning, action)', js)
        self.assertIn('closePanelConfirm(false)', js)
        self.assertIn('closePanelConfirm(true)', js)
        self.assertIn("event.key === 'Escape'", js)

    def test_html_contains_accessible_dialog_and_custom_forms(self):
        html = (ROOT / 'app/index.html').read_text()
        self.assertIn('role="alertdialog"', html)
        self.assertIn('aria-modal="true"', html)
        self.assertIn('id="confirmCancel"', html)
        self.assertIn('id="confirmAccept"', html)
        self.assertIn('id="wifiDialogForm" novalidate', html)
        self.assertIn('id="hotspotForm" novalidate', html)

    def test_existing_api_not_changed(self):
        client = TestClient(main.app)
        response = client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('v0.3.13', response.text)
        css = client.get('/assets/app.css')
        self.assertEqual(css.status_code, 200)
        self.assertIn('.confirm-backdrop', css.text)
        self.assertEqual(client.get('/api/health').status_code, 401)

if __name__ == '__main__': unittest.main()
