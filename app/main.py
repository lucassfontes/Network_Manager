import os, subprocess, re, secrets
from pathlib import Path
from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

app=FastAPI(title="Painel de Rede Linux", version="0.3.10")
app.mount("/assets", StaticFiles(directory=Path(__file__).resolve().parent / "assets"), name="assets")
TOKEN=os.environ.get("PANEL_TOKEN","")
REQUIRE_READ_TOKEN = os.environ.get('PANEL_REQUIRE_READ_TOKEN') == '1'

def token_is_secure():
    return (len(TOKEN) >= 24 and not TOKEN.startswith(('SUBSTITUA_', 'TROQUE_', 'EXEMPLO_')))

@app.middleware('http')
async def secure_lan_queries(request: Request, call_next):
    if request.url.path.startswith('/api/') and request.url.path != '/api/config' and request.method == 'GET' and REQUIRE_READ_TOKEN:
        received = request.headers.get('x-panel-token', '')
        if not token_is_secure() or not secrets.compare_digest(received, TOKEN):
            return JSONResponse({'detail': 'Token de acesso necessário para consultar a rede.'}, status_code=401)
    return await call_next(request)

@app.get('/api/config')
def config():
    return {'version': '0.3.10', 'readRequiresToken': REQUIRE_READ_TOKEN}

def cmd(*args, timeout=25, check=True):
    try:
        p=subprocess.run(args, capture_output=True,text=True,timeout=timeout)
    except (OSError,subprocess.TimeoutExpired) as e: raise HTTPException(503,str(e))
    if check and p.returncode: raise HTTPException(400,(p.stderr or p.stdout).strip()[:500])
    return p.stdout

def auth(x_panel_token: str|None):
    if not token_is_secure() or not secrets.compare_digest(x_panel_token or '',TOKEN): raise HTTPException(401,'Token inválido ou não configurado')

def device_ok(name,kind=None):
    if not re.fullmatch(r'[a-zA-Z0-9_.:-]{1,64}',name): raise HTTPException(400,'Interface inválida')
    rows=cmd('nmcli','-t','-f','DEVICE,TYPE','device','status').splitlines()
    if not any(row.startswith(name+':') and (kind is None or row.split(':',1)[1]==kind) for row in rows): raise HTTPException(404,'Interface não encontrada ou tipo incompatível')
    return name

def fields(*args): return cmd('nmcli','-t','-f',*args).splitlines()

def split_nmcli(line: str, count: int | None = None) -> list[str]:
    """Interpreta ':' e '\\' escapados no formato terse do nmcli."""
    parts, buf = [], []
    escaped = False
    for char in line:
        if escaped:
            buf.append(char)
            escaped = False
        elif char == '\\':
            escaped = True
        elif char == ':' and (count is None or len(parts) < count - 1):
            parts.append(''.join(buf)); buf = []
        else:
            buf.append(char)
    if escaped: buf.append('\\')
    parts.append(''.join(buf))
    return parts


def ap_capability(iw_output: str) -> str:
    match = re.search(r'Supported interface modes:\s*(.*?)(?=\n\s*(?:Band \d+:|software interface modes|valid interface combinations|Supported commands|\w[^\n]*:)|\Z)', iw_output, re.S | re.I)
    if not match:
        return 'não foi possível verificar'
    return 'sim (anunciado pelo driver)' if re.search(r'^\s*\*\s+AP\s*$', match.group(1), re.M) else 'não (não anunciado pelo driver)'

@app.get('/api/devices')
def devices():
    rows=fields('DEVICE,TYPE,STATE,CONNECTION','device','status')
    output=[]
    for line in rows:
        a=split_nmcli(line,4)
        if len(a)<4: continue
        dev,typ,state,connection=a
        info={'device':dev,'type':typ,'state':state,'connection':connection,'ap':'não aplicável' if typ!='wifi' else 'não foi possível verificar','simultaneous':'não foi possível verificar'}
        if typ=='wifi':
            try:
                phy=Path('/sys/class/net')/dev/'phy80211'
                if phy.exists():
                    phyname=phy.resolve().name
                    out=cmd('iw','phy',phyname,'info',check=False)
                    info['ap']=ap_capability(out)
            except Exception: pass
        try:
            driver_path=Path('/sys/class/net')/dev/'device/driver'
            info['driver']=driver_path.resolve().name if driver_path.exists() else 'não identificado'
        except Exception: info['driver']='não identificado'
        output.append(info)
    return output

@app.get('/api/default-route')
def default_route():
    try:
        result=cmd('ip','-4','route','show','default',timeout=5).strip()
    except HTTPException:
        return {'route':'não foi possível verificar'}
    return {'route':result or 'sem rota IPv4 padrão'}

@app.get('/api/wifi')
def wifi(device:str|None=None):
    args=['nmcli','-t','-f','IN-USE,SSID,SIGNAL,SECURITY','device','wifi','list']
    if device: args+=['ifname',device_ok(device,'wifi')]
    lines = cmd(*args).splitlines()
    networks = []
    for line in lines:
        values = split_nmcli(line, 4)
        if len(values) != 4: continue
        in_use, ssid, signal, security = values
        if not ssid: continue
        try: signal_num = max(0, min(100, int(signal)))
        except ValueError: signal_num = 0
        networks.append({'ssid': ssid, 'signal': signal_num,
                         'security': security or 'Aberta', 'inUse': in_use.strip() == '*'})
    networks.sort(key=lambda item: (not item['inUse'], -item['signal']))
    return {'lines':lines, 'networks':networks}

@app.get('/api/ip')
def ip_details(device: str):
    device_ok(device)
    output = cmd('nmcli', '-f', 'IP4.ADDRESS,IP4.GATEWAY,IP4.DNS,IP6.ADDRESS,IP6.GATEWAY',
                 'device', 'show', device, timeout=9)
    details = {'device': device, 'ipv4': [], 'gateway': '', 'dns': [], 'ipv6': [], 'gateway6': ''}
    pattern = re.compile(r'^\s*(IP[46]\.[A-Z]+)(?:\[\d+\])?\s*:\s*(.*?)\s*$')
    for line in output.splitlines():
        match = pattern.match(line)
        if not match or not match.group(2): continue
        field, value = match.groups()
        key = {'IP4.ADDRESS': 'ipv4', 'IP4.GATEWAY': 'gateway', 'IP4.DNS': 'dns',
               'IP6.ADDRESS': 'ipv6', 'IP6.GATEWAY': 'gateway6'}.get(field)
        if not key: continue
        if isinstance(details[key], list): details[key].append(value)
        else: details[key] = value
    return details

@app.get('/api/health')
def health():
    """Não basta a página carregar: verifica a comunicação real com o NM no host."""
    try:
        state=cmd('nmcli','-t','-f','STATE','general',timeout=7).strip()
    except HTTPException as exc:
        error=str(exc.detail)
        if 'AppArmor policy prevents' in error:
            error='AppArmor bloqueou o D-Bus. Recrie o contêiner com a configuração v0.3.10.'
        raise HTTPException(503, 'NetworkManager inacessível: '+error)
    return {'ok':True,'version':'0.3.10','networkManagerState':state}

@app.get('/api/status')
def status():
    return {'general':cmd('nmcli','-t','-f','STATE,CONNECTIVITY','general').strip(), 'connections':cmd('nmcli','-t','-f','NAME,DEVICE,TYPE','connection','show','--active').splitlines()}

class Connect(BaseModel):
    device:str
    ssid:str=Field(min_length=1,max_length=128)
    password:str|None=None
class Hotspot(BaseModel):
    device:str
    ssid:str=Field(min_length=1,max_length=32)
    password:str=Field(min_length=8,max_length=63)
class Interface(BaseModel): device:str

@app.post('/api/connect')
def connect(data:Connect,x_panel_token:str|None=Header(None)):
    auth(x_panel_token); device_ok(data.device,'wifi')
    args=['nmcli','--wait','20','device','wifi','connect',data.ssid,'ifname',data.device]
    if data.password: args+=['password',data.password]
    return {'result':cmd(*args,timeout=35).strip()}

@app.post('/api/hotspot')
def hotspot(data: Hotspot, x_panel_token: str | None = Header(None)):
    auth(x_panel_token)
    device_ok(data.device, 'wifi')
    if len(data.ssid.encode('utf-8')) > 32:
        raise HTTPException(400, 'Nome Wi-Fi ultrapassa 32 bytes UTF-8.')
    if not 8 <= len(data.password.encode('utf-8')) <= 63:
        raise HTTPException(400, 'A senha deve ter entre 8 e 63 bytes.')

    # Perfil Wi-Fi explicito: evita depender de "nmcli device wifi hotspot",
    # que falhou na combinacao de versoes nmcli 1.52 / NetworkManager 1.46.
    name = f'ZNM-Hotspot-{secrets.token_hex(5)}'
    created = False
    try:
        cmd('nmcli', 'connection', 'add', 'type', 'wifi', 'ifname', data.device,
            'con-name', name, 'ssid', data.ssid, timeout=20)
        created = True
        cmd('nmcli', 'connection', 'modify', name,
            '802-11-wireless.mode', 'ap',
            '802-11-wireless.ssid', data.ssid,
            '802-11-wireless-security.key-mgmt', 'wpa-psk',
            '802-11-wireless-security.psk', data.password,
            'ipv4.method', 'shared',
            'ipv6.method', 'ignore',
            'connection.autoconnect', 'no', timeout=20)
        result = cmd('nmcli', '--wait', '30', 'connection', 'up', 'id', name,
                     'ifname', data.device, timeout=40).strip()
    except HTTPException as exc:
        if created:
            # Remove so o perfil recem-criado, nunca as redes existentes.
            try: cmd('nmcli', 'connection', 'delete', 'id', name, timeout=12)
            except HTTPException: pass
        if 'mac-address-denylist' in str(exc.detail):
            raise HTTPException(503,
                'Incompatibilidade entre o nmcli do contêiner e o NetworkManager do host. '
                'Instale a v0.3.10 e execute iniciar.sh para reconstruir a imagem Docker.') from exc
        raise
    return {'result': result or 'Hotspot ativado.', 'connection': name,
            'note': 'A internet compartilhada usa a rota padrao. A placa Wi-Fi selecionada pode perder sua conexao atual.'}

def list_active_hotspots():
    """Return only active wireless AP profiles, never ordinary client Wi-Fi.

    UUIDs identify NM profiles even if a name was changed or contains ':';
    using the connection UUID avoids disconnecting a different device.
    """
    rows = cmd('nmcli', '-t', '-f', 'UUID,NAME,TYPE,DEVICE',
               'connection', 'show', '--active', timeout=12).splitlines()
    hotspots = []
    for line in rows:
        data = split_nmcli(line, 4)
        if len(data) != 4:
            continue
        uuid, name, typ, device = data
        if typ not in ('wifi', '802-11-wireless') or not device:
            continue
        if not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', uuid):
            continue
        # Profile must explicitly be in AP mode to prevent accidentally
        # disconnecting a regular Wi-Fi connection via this endpoint.
        mode = cmd('nmcli', '-g', '802-11-wireless.mode',
                   'connection', 'show', 'uuid', uuid, timeout=8, check=False).strip().lower()
        if mode != 'ap':
            continue
        ssid = cmd('nmcli', '-g', '802-11-wireless.ssid',
                   'connection', 'show', 'uuid', uuid, timeout=8, check=False).strip()
        hotspots.append({'uuid': uuid, 'name': name, 'device': device,
                         'ssid': ssid or name, 'managedByApp': name.startswith('ZNM-Hotspot-')})
    return hotspots

@app.get('/api/hotspots')
def active_hotspots():
    return {'hotspots': list_active_hotspots()}

class StopHotspot(BaseModel):
    uuid: str = Field(pattern=r'^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$')

@app.post('/api/hotspot/stop')
def stop_hotspot(data: StopHotspot, x_panel_token: str | None = Header(None)):
    auth(x_panel_token)
    # Re-check current state immediately before writing: never disconnect
    # arbitrary saved profiles, inactive profiles or normal Wi-Fi clients.
    candidate = next((item for item in list_active_hotspots() if item['uuid'].lower() == data.uuid.lower()), None)
    if not candidate:
        raise HTTPException(404, 'Hotspot não está ativo ou não foi identificado como ponto de acesso.')
    cmd('nmcli', '--wait', '20', 'connection', 'down', 'uuid', candidate['uuid'], timeout=30)
    return {'result': f"Hotspot {candidate['ssid']} parado com sucesso.",
            'uuid': candidate['uuid'], 'device': candidate['device']}

@app.post('/api/disconnect')
def disconnect(data:Interface,x_panel_token:str|None=Header(None)):
    auth(x_panel_token); device_ok(data.device,'wifi')
    return {'result':cmd('nmcli','device','disconnect',data.device).strip()}

@app.get('/',response_class=HTMLResponse)
def index():
    return (Path(__file__).resolve().parent / 'index.html').read_text(encoding='utf-8')
