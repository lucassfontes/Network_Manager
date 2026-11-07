"""Edição transacional de perfis IP do NetworkManager com rollback temporizado.

Nunca altera senhas Wi-Fi ou perfis inativos. Reverte se a confirmação
não chegar, e recupera mudanças pendentes após uma reinicialização do app.
"""
from __future__ import annotations
import ipaddress
import json
import os
import re
import secrets
import threading
import time
from pathlib import Path

from fastapi import HTTPException
from pydantic import BaseModel, Field
from app import auth_store

TIMEOUT_SECONDS = 150
lock = threading.RLock()
FIELDS = (
    'ipv4.method', 'ipv4.addresses', 'ipv4.gateway', 'ipv4.dns', 'ipv4.ignore-auto-dns',
    'ipv6.method', 'ipv6.addresses', 'ipv6.gateway', 'ipv6.dns', 'ipv6.ignore-auto-dns'
)
UUID_RE = re.compile(r'^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$')

class IpChange(BaseModel):
    device: str = Field(min_length=1,max_length=64)
    mode: str  # auto | manual | shared
    address: str = ''
    gateway: str = ''
    dns: str = ''
    ipv6Mode: str = 'unchanged' # unchanged | auto | manual | disabled
    ipv6Address: str = ''
    ipv6Gateway: str = ''
    ipv6Dns: str = ''


def _pending_path():
    path = auth_store.DATA_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path / 'ip-pending.json'


def _read():
    try: return json.loads(_pending_path().read_text(encoding='utf8'))
    except FileNotFoundError: return None


def _write(data):
    path = _pending_path()
    temp = path.with_suffix('.tmp')
    with os.fdopen(os.open(temp,os.O_CREAT|os.O_WRONLY|os.O_TRUNC,0o600), 'w', encoding='utf8') as f:
        json.dump(data,f,ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temp,path)


def _current_profile(device, cmd, device_ok, split_nmcli):
    device_ok(device)
    rows = cmd('nmcli','-t','-f','UUID,TYPE,DEVICE','connection','show','--active',timeout=12).splitlines()
    for line in rows:
        fields = split_nmcli(line,3)
        if len(fields)!=3: continue
        uuid, typ, dev = fields
        if dev == device and typ in ('wifi','802-11-wireless','ethernet','802-3-ethernet') and UUID_RE.fullmatch(uuid):
            return uuid,typ
    raise HTTPException(409,'A placa não possui perfil Wi-Fi/Ethernet ativo. Conecte-a antes de alterar o IP.')


def _get_setting(uuid, setting, cmd):
    result = cmd('nmcli','-g',setting,'connection','show','uuid',uuid,timeout=10).strip()
    return '' if result in ('--','(null)') else result


def _snapshot(uuid, cmd):
    return {key:_get_setting(uuid,key,cmd) for key in FIELDS}


def _is_hotspot(uuid, typ, cmd):
    if typ not in ('wifi','802-11-wireless'): return False
    return _get_setting(uuid,'802-11-wireless.mode',cmd).strip().lower()=='ap'


def profile_info(device,cmd,device_ok,split_nmcli):
    uuid,typ=_current_profile(device,cmd,device_ok,split_nmcli)
    settings=_snapshot(uuid,cmd)
    return {'device':device,'uuid':uuid,'hotspot':_is_hotspot(uuid,typ,cmd),
            'connection':_get_setting(uuid,'connection.id',cmd),
            'settings':settings}


def _addr(text, version, required=False, shared=False):
    text=str(text or '').strip()
    if not text:
        if required: raise HTTPException(400,f'Informe o endereço IPv{version} com prefixo (ex.: 192.168.10.2/24).')
        return ''
    try:
        obj=ipaddress.ip_interface(text)
        if obj.version!=version: raise ValueError('versão incorreta')
        if shared and not 1<=obj.network.prefixlen<=30: raise ValueError('prefixo não permite clientes DHCP')
        return str(obj)
    except ValueError: raise HTTPException(400,f'Endereço IPv{version} ou prefixo inválido.')


def _gateway(value, version, address=''):
    value=str(value or '').strip()
    if not value: return ''
    try:
        ip=ipaddress.ip_address(value)
        if ip.version!=version: raise ValueError()
        if address and ip not in ipaddress.ip_interface(address).network:
            raise HTTPException(400,f'O gateway IPv{version} deve estar na mesma sub-rede do endereço configurado.')
        return str(ip)
    except ValueError: raise HTTPException(400,f'Gateway IPv{version} inválido.')


def _dns(value, version):
    raw=[x for x in re.split(r'[\s,;]+',str(value or '').strip()) if x]
    if len(raw)>4: raise HTTPException(400,'Informe até quatro servidores DNS.')
    try:
        addresses=[str(ipaddress.ip_address(x)) for x in raw]
        if any(ipaddress.ip_address(x).version!=version for x in addresses): raise ValueError()
        return ' '.join(addresses)
    except ValueError: raise HTTPException(400,f'DNS IPv{version} inválido.')


def _properties(request:IpChange, hotspot):
    if request.mode not in ('auto','manual','shared'):
        raise HTTPException(400,'Escolha DHCP, Estático ou Compartilhado.')
    if hotspot and request.mode!='shared':
        raise HTTPException(400,'Em um hotspot, o IPv4 precisa ficar em modo Compartilhado.')
    if not hotspot and request.mode=='shared':
        raise HTTPException(400,'Modo Compartilhado é permitido apenas para hotspot ativo.')
    if request.ipv6Mode not in ('unchanged','auto','manual','disabled'):
        raise HTTPException(400,'Modo IPv6 inválido.')
    if hotspot and request.ipv6Mode!='unchanged':
        raise HTTPException(400,'IPv6 do hotspot não pode ser alterado nesta tela.')
    props={}
    address=_addr(request.address,4,required=request.mode in ('manual','shared'),shared=request.mode=='shared') if request.mode!='auto' else ''
    gateway=_gateway(request.gateway,4,address) if request.mode=='manual' else ''
    dns=_dns(request.dns,4) if request.mode in ('auto','manual') else ''
    props.update({'ipv4.method':request.mode, 'ipv4.addresses':address,
                  'ipv4.gateway':gateway,'ipv4.dns':dns,
                  'ipv4.ignore-auto-dns':'yes' if dns else 'no'})
    if request.ipv6Mode!='unchanged':
        addr6=_addr(request.ipv6Address,6,required=request.ipv6Mode=='manual') if request.ipv6Mode=='manual' else ''
        gw6=_gateway(request.ipv6Gateway,6,addr6) if request.ipv6Mode=='manual' else ''
        dns6=_dns(request.ipv6Dns,6) if request.ipv6Mode in ('auto','manual') else ''
        props.update({'ipv6.method':request.ipv6Mode,'ipv6.addresses':addr6,
                      'ipv6.gateway':gw6,'ipv6.dns':dns6,
                      'ipv6.ignore-auto-dns':'yes' if dns6 else 'no'})
    return props


def _modify(uuid, settings, cmd):
    args=['nmcli','--wait','20','connection','modify','uuid',uuid]
    for key,value in settings.items(): args.extend([key,value])
    return cmd(*args,timeout=30)


def _activate_if_same(device,uuid,cmd,split_nmcli):
    # Nunca reativa um perfil se outra conexão tiver assumido a interface.
    rows=cmd('nmcli','-t','-f','UUID,DEVICE','connection','show','--active',timeout=10).splitlines()
    current={p[1]:p[0] for line in rows if len(p:=split_nmcli(line,2))==2}
    if current.get(device) not in (uuid,None): return False
    cmd('nmcli','--wait','30','connection','up','uuid',uuid,'ifname',device,timeout=45)
    return True


def rollback(change,cmd,split_nmcli):
    error=''
    try:
        _modify(change['uuid'],change['before'],cmd)
        _activate_if_same(change['device'],change['uuid'],cmd,split_nmcli)
    except Exception as exc:
        error=str(getattr(exc,'detail',exc))[:300]
    with lock:
        latest=_read()
        if latest and latest['id']==change['id'] and latest['status']!='confirmed':
            latest['status']='rollback_error' if error else 'rolled_back'
            latest['message']= ('Não foi possível restaurar automaticamente: '+error) if error else 'Configuração anterior restaurada.'
            _write(latest)
    return not error


def run_apply(change, cmd, split_nmcli):
    try:
        _modify(change['uuid'],change['after'],cmd)
        if not _activate_if_same(change['device'],change['uuid'],cmd,split_nmcli):
            raise RuntimeError('A interface está em outra conexão; o perfil IP não foi ativado.')
        with lock:
            latest=_read()
            if not latest or latest['id']!=change['id']: return
            latest.update(status='await_confirmation',expires=time.time()+TIMEOUT_SECONDS,
                          message='Confirme o acesso ao servidor antes do prazo, ou a configuração será restaurada.')
            _write(latest)
        while True:
            with lock:
                latest=_read()
                if not latest or latest['id']!=change['id'] or latest['status']!='await_confirmation': return
                if time.time()>=latest['expires']: break
            time.sleep(1)
        rollback(change,cmd,split_nmcli)
    except Exception as exc:
        rollback(change,cmd,split_nmcli)
        with lock:
            latest=_read()
            if latest and latest['id']==change['id']:
                latest['status']='error' if latest['status']=='rolled_back' else latest['status']
                latest['message']='Falha ao aplicar: '+str(getattr(exc,'detail',exc))[:300]+'. '+latest.get('message','')
                _write(latest)


def begin(request,cmd,device_ok,split_nmcli):
    with lock:
        pending=_read()
        if pending and pending['status'] in ('applying','await_confirmation'):
            raise HTTPException(409,'Há uma alteração aguardando confirmação. Confirme ou aguarde a restauração.')
        info=profile_info(request.device,cmd,device_ok,split_nmcli)
        props=_properties(request,info['hotspot'])
        txn={'id':secrets.token_urlsafe(16),'device':request.device,'uuid':info['uuid'],
             'before':info['settings'],'after':props,'status':'applying','expires':None,
             'message':'Aplicando configuração de rede. Aguarde...'}
        _write(txn)
    return txn


def get_pending():
    with lock:
        p=_read()
        if not p: return {'status':'idle'}
        return {key:p.get(key) for key in ('id','device','status','expires','message')}


def confirm(transaction_id):
    with lock:
        p=_read()
        if not p or p['id']!=transaction_id: raise HTTPException(404,'Alteração de rede não encontrada.')
        if p['status']!='await_confirmation': raise HTTPException(409,'A configuração ainda não está aguardando confirmação.')
        if time.time()>=p['expires']:
            raise HTTPException(409,'Prazo esgotado. A configuração será restaurada.')
        p['status']='confirmed'
        p['message']='Configuração salva e confirmada. Você continuará conectado.'
        _write(p)
        return {'result':p['message']}


def recover_at_startup(cmd,split_nmcli):
    """Se o contêiner reiniciou durante uma mudança, restaura a última configuração."""
    with lock:
        p=_read()
    if p and p['status'] in ('applying','await_confirmation'):
        threading.Thread(target=rollback,args=(p,cmd,split_nmcli),daemon=True).start()
