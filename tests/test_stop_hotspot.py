"""Simulated NM integration: stopping hotspots never disconnects a client Wi-Fi."""
import unittest
from unittest.mock import patch
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app import main
from tests.auth_fixtures import AuthTestCase

HOTSPOT_UUID = '11111111-2222-3333-4444-555555555555'
WIFI_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
OTHER_UUID = '01234567-89ab-cdef-0123-456789abcdef'


def nm_fake(*args, **kw):
    if args == ('nmcli', '-t', '-f', 'UUID,NAME,TYPE,DEVICE', 'connection', 'show', '--active'):
        # actual call adds kw timeout only
        return f'{HOTSPOT_UUID}:ZNM-Hotspot-1:wifi:wlp5s0\n{WIFI_UUID}:Home Wifi:wifi:wlp7s0\n{OTHER_UUID}:Other AP:wifi:wlp8s0\n'
    if args[:4] == ('nmcli', '-g', '802-11-wireless.mode', 'connection'):
        return 'client\n' if WIFI_UUID in args else 'ap\n'
    if args[:4] == ('nmcli', '-g', '802-11-wireless.ssid', 'connection'):
        return 'Home Wifi\n' if WIFI_UUID in args else 'Other Wi-Fi\n' if OTHER_UUID in args else 'Demo Hotspot\n'
    if args[:5] == ('nmcli', '--wait', '20', 'connection', 'down'):
        return 'Connection successfully deactivated\n'
    raise AssertionError(f'Unexpected nmcli call: {args!r}')


class StopHotspotTests(AuthTestCase):
    def setUp(self):
        super().setUp()
        self.setup_account()

    def test_detects_only_active_ap_profiles_even_non_project(self):
        with patch.object(main, 'cmd', side_effect=nm_fake):
            response = self.client.get('/api/hotspots')
        self.assertEqual(response.status_code, 200)
        hotspots = response.json()['hotspots']
        self.assertEqual({x['uuid'] for x in hotspots}, {HOTSPOT_UUID, OTHER_UUID})
        self.assertTrue(next(x for x in hotspots if x['uuid'] == HOTSPOT_UUID)['managedByApp'])
        self.assertFalse(next(x for x in hotspots if x['uuid'] == OTHER_UUID)['managedByApp'])

    def test_stops_only_selected_hotspot_uuid(self):
        with patch.object(main, 'cmd', side_effect=nm_fake) as fake:
            response = self.client.post('/api/hotspot/stop', json={'uuid': OTHER_UUID}, headers={'X-CSRF-Token': self.csrf})
        self.assertEqual(response.status_code, 200, response.text)
        change = [c.args for c in fake.call_args_list if 'down' in c.args]
        self.assertEqual(len(change), 1)
        self.assertEqual(change[0][:7], ('nmcli','--wait','20','connection','down','uuid', OTHER_UUID))
        self.assertFalse(any('disconnect' in c.args for c in fake.call_args_list))
        self.assertFalse(any('delete' in c.args for c in fake.call_args_list))

    def test_cannot_stop_normal_client_wifi(self):
        with patch.object(main, 'cmd', side_effect=nm_fake) as fake:
            response = self.client.post('/api/hotspot/stop', json={'uuid': WIFI_UUID}, headers={'X-CSRF-Token': self.csrf})
        self.assertEqual(response.status_code, 404)
        self.assertFalse(any('down' in c.args for c in fake.call_args_list))

    def test_no_csrf_no_nm_access(self):
        with patch.object(main, 'cmd') as fake:
            response = self.client.post('/api/hotspot/stop', json={'uuid': HOTSPOT_UUID})
        self.assertEqual(response.status_code, 403)
        fake.assert_not_called()

    def test_invalid_uuid_rejected(self):
        with patch.object(main, 'cmd') as fake:
            response = self.client.post('/api/hotspot/stop', json={'uuid': 'uuid; rm -rf /'}, headers={'X-CSRF-Token': self.csrf})
        self.assertEqual(response.status_code, 422)
        fake.assert_not_called()

    def test_ap_mode_query_failed_does_not_expose_unsafe_stop(self):
        def bad_mode(*args, **kwargs):
            if '802-11-wireless.mode' in args:
                return ''
            return nm_fake(*args, **kwargs)
        with patch.object(main, 'cmd', side_effect=bad_mode):
            self.assertEqual(self.client.get('/api/hotspots').json()['hotspots'], [])

if __name__=='__main__': unittest.main()
