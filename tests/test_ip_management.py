"""IP settings tests never call a real host NetworkManager."""
import time
from pathlib import Path
from unittest.mock import patch
from fastapi import HTTPException
from app import main, ip_manager, auth_store
from tests.auth_fixtures import AuthTestCase

UUID = '12345678-1111-2222-3333-abcdefabcdef'
BASE = {'ipv4.method':'auto','ipv4.addresses':'','ipv4.gateway':'','ipv4.dns':'',
        'ipv4.ignore-auto-dns':'no','ipv6.method':'auto','ipv6.addresses':'',
        'ipv6.gateway':'','ipv6.dns':'','ipv6.ignore-auto-dns':'no'}


def fake_profile(device='wlan1', hotspot=False):
    return {'device':device,'uuid':UUID,'hotspot':hotspot,'connection':'VOO-NET', 'settings':dict(BASE)}

class IpManagementTests(AuthTestCase):
    def setUp(self):
        super().setUp()
        self.setup_account()

    def test_password_six_characters_on_setup_and_change(self):
        result=self.secured_post('/api/auth/change-password',{'currentPassword':'UmaSenhaForte-123456','newPassword':'123456'})
        self.assertEqual(result.status_code,200,result.text)
        logged=self.client.post('/api/auth/login',json={'username':'admin','password':'123456'})
        self.assertEqual(logged.status_code,200,logged.text)

    def test_profile_read_protected_from_unauthenticated_user(self):
        with patch.object(ip_manager,'profile_info',return_value=fake_profile()) as get:
            result=self.client.get('/api/ip/config?device=wlan1')
            self.assertEqual(result.status_code,200)
            self.assertEqual(result.json()['connection'],'VOO-NET')
            self.client.cookies.clear()
            self.assertEqual(self.client.get('/api/ip/config?device=wlan1').status_code,401)
            get.assert_called_once()

    def test_new_write_routes_require_csrf(self):
        with patch.object(ip_manager,'begin') as begin:
            self.assertEqual(self.client.post('/api/ip/apply',json={'device':'wlan1','mode':'auto'}).status_code,403)
            begin.assert_not_called()
        with patch.object(ip_manager,'confirm') as confirm:
            self.assertEqual(self.client.post('/api/ip/confirm',json={'id':'abc'}).status_code,403)
            confirm.assert_not_called()

    def test_prepare_dhcp_and_static(self):
        s=ip_manager._properties(ip_manager.IpChange(device='wlan1',mode='manual',address='192.168.5.12/24',gateway='192.168.5.1',dns='1.1.1.1, 8.8.8.8',ipv6Mode='manual',ipv6Address='2001:db8::12/64',ipv6Gateway='2001:db8::1'),False)
        self.assertEqual(s['ipv4.method'],'manual')
        self.assertEqual(s['ipv4.gateway'],'192.168.5.1')
        self.assertEqual(s['ipv4.dns'],'1.1.1.1 8.8.8.8')
        self.assertEqual(s['ipv6.method'],'manual')
        a=ip_manager._properties(ip_manager.IpChange(device='wlan1',mode='auto',address='192.168.5.12/24'),False)
        self.assertEqual(a['ipv4.method'],'auto')
        self.assertEqual(a['ipv4.addresses'],'')
        self.assertNotIn('ipv6.method',a)

    def test_hotspot_shared_mode_and_invalid_configs(self):
        o=ip_manager._properties(ip_manager.IpChange(device='wlan1',mode='shared',address='10.42.0.1/24'),True)
        self.assertEqual(o['ipv4.method'],'shared')
        self.assertEqual(o['ipv4.addresses'],'10.42.0.1/24')
        for data,hotspot in [
            ({'mode':'auto'},True),({'mode':'shared','address':'10.42.0.1/24'},False),
            ({'mode':'manual','address':'192.168.1.5/24','gateway':'10.0.0.1'},False),
            ({'mode':'manual','address':'wat'},False),
            ({'mode':'auto','dns':'1.1.1.1;bad'},False),
            ({'mode':'shared','address':'10.42.0.1/32'},True),
            ({'mode':'shared','address':'10.42.0.1/24','ipv6Mode':'disabled'},True),
        ]:
            with self.subTest(data=data):
                with self.assertRaises(HTTPException):
                    ip_manager._properties(ip_manager.IpChange(device='wlan1',**data),hotspot)

    def test_begin_and_confirm_persist(self):
        with patch.object(ip_manager,'profile_info',return_value=fake_profile()):
            started=ip_manager.begin(ip_manager.IpChange(device='wlan1',mode='auto'),main.cmd,main.device_ok,main.split_nmcli)
        self.assertEqual(started['status'],'applying')
        self.assertTrue((Path(self.temp.name)/'ip-pending.json').exists())
        self.assertEqual(ip_manager.get_pending()['status'],'applying')
        with self.assertRaises(HTTPException): ip_manager.confirm(started['id'])
        started['status']='await_confirmation';started['expires']=time.time()+120
        ip_manager._write(started)
        self.assertIn('confirmada',ip_manager.confirm(started['id'])['result'])
        self.assertEqual(ip_manager.get_pending()['status'],'confirmed')

    def test_apply_error_rolls_back(self):
        change={'id':'txn','device':'wlan1','uuid':UUID,'before':dict(BASE),
                'after':{'ipv4.method':'manual','ipv4.addresses':'192.168.1.2/24'},
                'status':'applying','expires':None}
        ip_manager._write(change)
        ops=[]
        def modify(uuid,settings,cmd):
            ops.append(settings)
            if len(ops)==1: raise RuntimeError('Activation failed')
        with patch.object(ip_manager,'_modify',side_effect=modify), patch.object(ip_manager,'_activate_if_same',return_value=True):
            ip_manager.run_apply(change,None,None)
        self.assertEqual(len(ops),2)
        self.assertEqual(ops[-1],BASE)
        self.assertEqual(ip_manager.get_pending()['status'],'error')

    def test_rollback_does_not_override_confirmed_change(self):
        change={'id':'txn','device':'wlan1','uuid':UUID,'before':dict(BASE),
                'after':{'ipv4.method':'manual'},'status':'confirmed','expires':None}
        ip_manager._write(change)
        # Thread that wakes after confirmation exits without invoking rollback.
        with patch.object(ip_manager,'_modify') as modify:
            ip_manager.recover_at_startup(None,None)
            modify.assert_not_called()

    def test_profile_checks_active_uuid_and_type(self):
        def cmd(*args,**kw):
            if 'connection' in args and '--active' in args:
                return f'{UUID}:wifi:wlan1\n'
            if args[0]=='nmcli' and '-g' in args:
                return 'ap' if '802-11-wireless.mode' in args else ''
            return ''
        with patch.object(main,'device_ok',return_value='wlan1') as chk:
            uuid,typ=ip_manager._current_profile('wlan1',cmd,main.device_ok,main.split_nmcli)
        self.assertEqual(uuid,UUID)
        self.assertEqual(typ,'wifi')
        self.assertTrue(ip_manager._is_hotspot(uuid,typ,cmd))
