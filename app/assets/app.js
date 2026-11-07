/* ZimaOS Network Manager · v0.3.12 — interface visual, sem bibliotecas externas. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const state = { authenticated: false, username: '', csrf: '', devices: [], route: null, status: null, health: null, networks: [], hotspots: [], errors: {} };
  const labels = {
    overview: ['Visão geral', 'Acompanhe suas conexões e os dispositivos disponíveis, sem informações complicadas.'],
    devices: ['Dispositivos', 'Veja as placas de rede detectadas e o que cada uma consegue fazer.'],
    wifi: ['Redes Wi-Fi', 'Procure redes próximas e conecte-se à que você escolher.'],
    hotspot: ['Hotspot', 'Veja, pare ou crie pontos de acesso Wi-Fi.'],
    share: ['Compartilhar internet', 'Entenda qual conexão fornece a internet para o hotspot.'],
    ip: ['Endereços IP', 'Configure DHCP, IP estático, gateway e DNS das conexões.'],
    status: ['Diagnóstico', 'Confira o estado do NetworkManager e as conexões ativas.'],
    settings: ['Minha conta', 'Gerencie sua sessão e altere sua senha de acesso.']
  };
  const ico = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Avisos e confirmações são renderizados pelo próprio painel, sem caixas nativas.
  function toast(message, type = 'ok') {
    const el = $('toast');
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = type === 'error' ? '×' : type === 'warn' ? '!' : '✓';
    const content = document.createElement('div');
    content.className = 'toast-message';
    content.textContent = String(message);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Fechar mensagem');
    close.textContent = '×';
    close.addEventListener('click', () => { clearTimeout(toast.timer); el.className = 'toast'; });
    el.replaceChildren(icon, content, close);
    el.className = 'toast show' + (type === 'ok' ? '' : ` ${type}`);
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    clearTimeout(toast.timer);
    // Erros permanecem visíveis até a pessoa fechá-los.
    if (type !== 'error') toast.timer = setTimeout(() => { el.className = 'toast'; }, type === 'warn' ? 9000 : 5500);
  }

  let confirmResolve = null;
  let focusBeforeConfirm = null;
  function closePanelConfirm(accepted) {
    if (!confirmResolve) return;
    const done = confirmResolve;
    confirmResolve = null;
    $('panelConfirm').hidden = true;
    document.body.classList.remove('dialog-open');
    if (focusBeforeConfirm?.isConnected && typeof focusBeforeConfirm.focus === 'function') focusBeforeConfirm.focus();
    focusBeforeConfirm = null;
    done(accepted);
  }
  function panelConfirm(message, action) {
    if (confirmResolve) return Promise.resolve(false);
    const actions = {
      connect: ['Conectar ao Wi-Fi?', 'Conectar', false],
      disconnect: ['Desconectar esta placa?', 'Desconectar', true],
      hotspot: ['Criar e ativar hotspot?', 'Criar hotspot', false],
      'hotspot/stop': ['Parar este hotspot?', 'Parar hotspot', true]
    };
    const [title, button, danger] = actions[action] || ['Confirmar alteração?', 'Confirmar', true];
    $('confirmTitle').textContent = title;
    $('confirmMessage').textContent = message;
    $('confirmAccept').textContent = button;
    $('confirmAccept').className = 'button ' + (danger ? 'button-danger' : 'button-primary');
    focusBeforeConfirm = document.activeElement;
    $('panelConfirm').hidden = false;
    document.body.classList.add('dialog-open');
    $('confirmCancel').focus();
    return new Promise(resolve => { confirmResolve = resolve; });
  }
  function confirmKeyboard(event) {
    if ($('panelConfirm').hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); closePanelConfirm(false); return; }
    if (event.key !== 'Tab') return;
    const items = [$('confirmClose'), $('confirmCancel'), $('confirmAccept')];
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  const active = (d) => String(d?.state || '').toLowerCase().startsWith('connected');
  const physical = (d) => d.type === 'wifi' || d.type === 'ethernet';
  const isWifi = (d) => d.type === 'wifi';
  const isHotspot = (d) => state.hotspots.some(h => h.device === d.device);
  const shortState = (d) => {
    if (active(d)) return ['Conectado', 'ok'];
    if (d.state === 'unavailable') return ['Indisponível', 'warn'];
    if (d.state === 'disconnected') return ['Desconectado', 'warn'];
    if (d.state === 'unmanaged') return ['Não gerenciado', 'warn'];
    return ['Desconectado', 'warn'];
  };
  const typeName = (d) => isWifi(d) ? 'Wi-Fi' : d.type === 'ethernet' ? 'Ethernet (cabo)' : d.type;
  const driverLabel = (d) => !d.driver || d.driver === 'não identificado' || d.driver === 'driver' ? 'Não identificado' : d.driver;
  function badge(d) { const [label, kind] = shortState(d); return `<span class="pill ${kind}">${label}</span>`; }
  function iconFor(d) { return isWifi(d) ? 'wifi' : 'ethernet'; }
  function symbol(d) { return `<span class="device-symbol ${isWifi(d) ? '' : 'ethernet'}">${ico(iconFor(d))}</span>`; }
  function apLabel(d) {
    if (!isWifi(d)) return 'Não aplicável';
    if (String(d.ap).startsWith('sim')) return 'Hotspot suportado pelo driver';
    if (String(d.ap).startsWith('não (')) return 'Hotspot não anunciado pelo driver';
    return 'Compatibilidade ainda não verificada';
  }
  function wifiConnected() { return state.devices.find(d => isWifi(d) && active(d)) || null; }
  function defaultRoute() {
    const route = state.route?.route || '';
    return { raw: route, iface: /(?:^|\s)dev\s+(\S+)/.exec(route)?.[1] || '', via: /(?:^|\s)via\s+(\S+)/.exec(route)?.[1] || '' };
  }
  function showAuth(message = '', setup = false) {
    state.authenticated = false;
    state.csrf = '';
    $('appShell').hidden = true;
    $('authView').hidden = false;
    document.body.classList.remove('dialog-open');
    $('wifiDialog').hidden = true;
    $('panelConfirm').hidden = true;
    $('loginForm').hidden = setup;
    $('setupForm').hidden = !setup;
    $('authTitle').textContent = setup ? 'Primeiro acesso' : 'Acessar o painel';
    $('authSubtitle').textContent = setup ? 'Configure o administrador para proteger seu servidor.' : 'Entre com seu usuário e senha.';
    $('authNotice').textContent = message;
    $('authNotice').hidden = !message;
    const input = setup ? $('setupCode') : $('loginUsername');
    setTimeout(() => input?.focus(), 20);
  }
  function showApp(data) {
    state.authenticated = true;
    state.username = data.username;
    state.csrf = data.csrf;
    $('currentUsername').textContent = data.username;
    $('userBadge').textContent = data.username;
    $('authView').hidden = true;
    $('appShell').hidden = false;
    $('loginPassword').value = '';
    $('setupPassword').value = '';
    $('setupPasswordConfirm').value = '';
    $('setupCode').value = '';
    refreshAll();
    checkIpPending();
  }
  async function api(path, options = {}) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), options.method === 'POST' ? 45000 : 13000);
    try {
      const headers = { ...(options.headers || {}) };
      if (options.method === 'POST' && state.csrf) headers['X-CSRF-Token'] = state.csrf;
      const r = await fetch('/api/' + path, { ...options, credentials: 'same-origin', headers, signal: controller.signal, cache: 'no-store' });
      let data;
      try { data = await r.json(); } catch { throw new Error(`Resposta inválida do servidor (HTTP ${r.status}).`); }
      if (!r.ok) {
        if (r.status === 401 && !path.startsWith('auth/') && state.authenticated) showAuth('Sua sessão expirou. Entre novamente.');
        const detail = data?.detail;
        throw new Error(typeof detail === 'string' ? detail : `Servidor respondeu HTTP ${r.status}.`);
      }
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('O servidor demorou demais para responder.');
      throw e;
    } finally { clearTimeout(t); }
  }
  function navigate(page) {
    if (!labels[page]) return;
    document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.id === `page-${page}`));
    document.querySelectorAll('.nav-link').forEach(el => {
      const activeNow = el.dataset.page === page;
      el.classList.toggle('active', activeNow);
      el.setAttribute('aria-current', activeNow ? 'page' : 'false');
    });
    $('pageTitle').textContent = labels[page][0];
    $('currentPageLabel').textContent = labels[page][0];
    $('pageSubtitle').textContent = labels[page][1];
    $('sidebar').classList.remove('open');
    $('mobileShade').classList.remove('visible');
    if (page === 'wifi') loadWifi();
    if (page === 'hotspot') loadHotspots();
    if (page === 'ip') loadIp();
    if (page === 'status') loadHealth();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function renderOverview() {
    const wifi = wifiConnected();
    const real = state.devices.filter(physical);
    const route = defaultRoute();
    const statusLine = String(state.status?.general || '').split(':')[0].toLowerCase();
    const routeOk = Boolean(route.iface);
    $('metricInternet').textContent = routeOk ? 'Rota disponível' : (state.errors.route ? 'Indisponível' : 'Sem rota ativa');
    $('metricInternetDesc').textContent = routeOk ? `Saída por ${route.iface}` : 'Acesso à internet não confirmado';
    $('metricWifi').textContent = wifi ? (wifi.connection || wifi.device) : 'Não conectado';
    $('metricWifiDesc').textContent = wifi ? `Interface ${wifi.device}` : 'Nenhuma conexão Wi-Fi ativa';
    $('metricDevices').textContent = String(real.length);
    $('metricDevicesDesc').textContent = `${real.filter(isWifi).length} Wi-Fi · ${real.filter(d => d.type === 'ethernet').length} Ethernet`;
    $('metricHotspot').textContent = state.devices.some(isHotspot) ? 'Ativo' : 'Não detectado';
    $('metricHotspotDesc').textContent = 'Conexões identificadas pelo NM';
    $('overviewRouteName').textContent = route.iface || 'Nenhuma rota padrão';
    $('overviewRouteAddress').textContent = route.via ? `Gateway ${route.via}` : (route.raw || 'Não foi possível determinar a origem');
    const el = $('overviewDevices');
    el.innerHTML = real.length ? real.map(d => `<div class="device-row">${symbol(d)}<div class="device-row-main"><strong>${esc(typeName(d))} · ${esc(d.device)}</strong><small>${esc(d.connection || (isWifi(d) ? apLabel(d) : driverLabel(d)))}</small></div>${badge(d)}</div>`).join('') : `<div class="empty">${state.errors.devices ? esc(state.errors.devices) : 'Nenhuma placa de rede física detectada.'}</div>`;
    const top = $('topConnection');
    top.className = 'top-connection ' + (routeOk ? 'ok' : (state.errors.health || statusLine === 'disconnected' ? 'bad' : ''));
    top.innerHTML = `<i class="pulse"></i> ${routeOk ? 'Rota ativa' : 'Sem rota confirmada'}`;
  }
  function renderDevices() {
    const real = state.devices.filter(physical);
    $('physicalDevices').innerHTML = real.length ? real.map(d => `<article class="device-card"><div class="device-card-top"><div class="device-card-title">${symbol(d)}<div><strong>${esc(typeName(d))}</strong><small>${esc(d.device)}</small></div></div>${badge(d)}</div><div class="device-card-row"><span>Conexão atual</span><strong>${esc(d.connection || 'Nenhuma')}</strong></div><div class="device-card-row"><span>Driver da placa</span><strong>${esc(driverLabel(d))}</strong></div>${isWifi(d) ? `<div class="device-card-row"><span>Suporte a hotspot</span><strong>${esc(apLabel(d))}</strong></div><div class="device-card-row"><span>Wi-Fi + hotspot ao mesmo tempo</span><strong>Não verificado</strong></div><button class="mini-link" data-goto="wifi">${ico('wifi')} Procurar redes</button>` : `<div class="device-card-row"><span>Conexão por cabo</span><strong>${d.state === 'unavailable' ? 'Sem link ou indisponível' : active(d) ? 'Em uso' : 'Não conectada'}</strong></div>`}</article>`).join('') : `<div class="empty">${state.errors.devices ? esc(state.errors.devices) : 'Não foram encontradas placas físicas.'}</div>`;
    const virt = state.devices.filter(d => !physical(d));
    $('virtualCount').textContent = `(${virt.length})`;
    $('virtualDevices').innerHTML = virt.length ? virt.map(d => `<div class="virtual-row"><div><strong>${esc(d.device)}</strong><br><small>${esc(d.type)}</small></div>${badge(d)}</div>`).join('') : '<p class="hint">Nenhuma interface virtual encontrada.</p>';
  }
  function updateSelect(id, devices, placeholder) {
    const el = $(id); const prev = el.value;
    el.innerHTML = devices.length ? devices.map(d => `<option value="${esc(d.device)}">${esc(typeName(d))} — ${esc(d.device)}${active(d) ? ' (conectado)' : ''}</option>`).join('') : `<option value="">${esc(placeholder)}</option>`;
    if (devices.some(d => d.device === prev)) el.value = prev;
  }
  function updateControls() {
    const real = state.devices.filter(physical), wifi = real.filter(isWifi);
    updateSelect('hotspotDevice', wifi, 'Nenhuma placa Wi-Fi');
    updateSelect('ipDevice', real, 'Nenhuma interface física');
    const scan = $('scanDevice'), was = scan.value;
    scan.innerHTML = '<option value="">Todas as placas Wi-Fi</option>' + wifi.map(d => `<option value="${esc(d.device)}">${esc(d.device)}${active(d) ? ' · conectada' : ''}</option>`).join('');
    if (wifi.some(d => d.device === was)) scan.value = was;
    $('hotspotForm').querySelector('button[type=submit]').disabled = !wifi.length;
    updateHotspotCapability();
  }
  async function loadDevices() {
    try { state.devices = await api('devices'); state.errors.devices = ''; }
    catch (e) { state.errors.devices = e.message; state.devices = []; }
    renderDevices(); updateControls(); renderOverview(); renderWifiCurrent();
  }
  function renderWifiCurrent() {
    const el = $('wifiCurrent');
    const wifi = state.devices.filter(isWifi);
    el.innerHTML = wifi.length ? wifi.map(d => `<div class="wifi-active-entry"><span class="device-symbol">${ico('wifi')}</span><div><strong>${esc(d.connection || 'Sem rede conectada')}</strong><small>${esc(d.device)} · ${active(d) ? 'Conectado' : 'Desconectado'}</small></div>${active(d) && !isHotspot(d) ? `<button type="button" class="button button-danger-outline button-small" data-wifi-device-disconnect="${esc(d.device)}">Desconectar</button>` : ''}</div>`).join('') : '<div class="empty">Nenhuma placa Wi-Fi encontrada.</div>';
  }
  function renderNetworks() {
    const el = $('wifiNetworks');
    if (state.errors.wifi) { el.innerHTML = `<div class="empty">Não foi possível procurar redes.<br>${esc(state.errors.wifi)}</div>`; return; }
    if (!state.networks.length) { el.innerHTML = '<div class="empty">Nenhuma rede encontrada. Verifique se o Wi-Fi está ligado e tente novamente.</div>'; return; }
    el.innerHTML = state.networks.map((n,i) => `<div class="network-row ${n.inUse ? 'current' : ''}"><button type="button" class="network-select" data-network-index="${i}"><span class="network-icon">${ico('wifi')}</span><span class="network-body"><strong>${esc(n.ssid)} ${n.inUse ? '<span class="pill ok">Conectada</span>' : ''}</strong><small>${esc(n.security && n.security !== '--' ? n.security : 'Rede aberta')} · ${n.signal}% de sinal · ${esc(n.device || 'Wi-Fi')}</small></span><span class="network-bars">${signalText(n.signal)}</span>${ico('chevron')}</button>${n.inUse ? `<button type="button" class="button button-danger-outline button-small network-disconnect" data-wifi-disconnect-index="${i}">Desconectar</button>` : ''}</div>`).join('');
  }
  function signalText(signal) { return signal >= 75 ? 'Excelente' : signal >= 50 ? 'Bom' : signal >= 25 ? 'Médio' : 'Fraco'; }
  async function loadWifi() {
    $('wifiNetworks').innerHTML = '<div class="loading">Procurando redes disponíveis...</div>';
    const selected = $('scanDevice').value;
    const devices = selected ? [selected] : state.devices.filter(isWifi).map(d=>d.device);
    const networks = []; const errors=[];
    for (const device of devices) {
      try {
        const data = await api('wifi?device=' + encodeURIComponent(device));
        for (const n of Array.isArray(data.networks) ? data.networks : []) networks.push({...n,device});
      } catch(e) { errors.push(device + ': ' + e.message); }
    }
    state.networks = networks.sort((a,b)=>Number(b.inUse)-Number(a.inUse) || b.signal-a.signal);
    state.errors.wifi = networks.length ? '' : errors.join(' | ');
    renderNetworks();
  }
  let chosenWifi = null, previousWifiFocus = null;
  function closeWifiDialog() {
    $('wifiDialog').hidden=true;
    $('wifiDialogPassword').value='';
    chosenWifi=null;
    document.body.classList.remove('dialog-open');
    previousWifiFocus?.focus?.();
    previousWifiFocus=null;
  }
  function openWifiDialog(network) {
    chosenWifi = network;
    previousWifiFocus = document.activeElement;
    $('wifiDialog').hidden = false;
    document.body.classList.add('dialog-open');
    $('wifiDialogTitle').textContent = network.ssid;
    const busy=state.devices.find(d=>d.device===network.device && active(d));
    $('wifiDialogDetail').textContent = network.inUse ? 'Esta rede está conectada. Você pode desligar a conexão.' : (network.security && network.security!=='--' ? 'Rede protegida. Digite a senha para conectar.' : 'Esta rede está aberta e não exige senha.') + (busy ? ' ATENÇÃO: ao conectar, você substituirá a conexão atual nesta placa.' : '');
    $('wifiDialogEyebrow').textContent = network.inUse ? 'WI-FI CONECTADO' : 'CONECTAR AO WI-FI';
    $('wifiDialogPasswordContainer').hidden = Boolean(network.inUse || !network.security || network.security==='--' || network.security==='Aberta');
    const wifiDevices = state.devices.filter(isWifi);
    $('wifiDialogDevice').innerHTML = wifiDevices.map(d=>`<option value="${esc(d.device)}">${esc(d.device)} ${active(d) ? '(conectado)' : ''}</option>`).join('');
    $('wifiDialogDevice').value = network.device || wifiDevices[0]?.device || '';
    $('wifiDialogDevice').disabled = Boolean(network.inUse);
    $('wifiDialogSubmit').textContent = network.inUse ? 'Desconectar' : 'Conectar';
    $('wifiDialogSubmit').className = 'button ' + (network.inUse ? 'button-danger' : 'button-primary');
    setTimeout(() => network.inUse ? $('wifiDialogSubmit').focus() : ($('wifiDialogPasswordContainer').hidden ? $('wifiDialogSubmit').focus() : $('wifiDialogPassword').focus()), 20);
  }
  function renderHotspots() {
    const el = $('activeHotspots');
    if (state.errors.hotspots) {
      el.innerHTML = `<div class="empty">Não foi possível verificar os hotspots: ${esc(state.errors.hotspots)}</div>`;
      return;
    }
    if (!state.hotspots.length) {
      el.innerHTML = '<div class="empty">Nenhum hotspot ativo encontrado. Hotspots desligados não aparecem nesta lista.</div>';
      return;
    }
    el.innerHTML = state.hotspots.map(h => `<div class="hotspot-entry">
      <span class="device-symbol">${ico('hotspot')}</span>
      <div class="hotspot-entry-info"><strong>${esc(h.ssid || h.name)}</strong>
        <small>${esc(h.device)} · ${h.managedByApp ? 'Criado pelo ZimaOS Network Manager' : 'Criado no Linux'}</small>
        <span class="pill ok">Ativo</span>
      </div>
      <button type="button" class="button button-danger hotspot-stop" data-stop-hotspot="${esc(h.uuid)}">${ico('alert')} Parar hotspot</button>
    </div>`).join('');
  }
  async function loadHotspots() {
    try {
      const data = await api('hotspots');
      state.hotspots = Array.isArray(data.hotspots) ? data.hotspots : [];
      state.errors.hotspots = '';
    } catch(e) {
      state.hotspots = [];
      state.errors.hotspots = e.message;
    }
    renderHotspots(); renderOverview(); renderWifiCurrent();
  }
  function updateHotspotCapability() {
    const d = state.devices.find(x => x.device === $('hotspotDevice').value);
    const el = $('hotspotCapability');
    if (!d) { el.textContent = 'Nenhuma placa Wi-Fi disponível.'; el.className = 'capability caution'; return; }
    const available = String(d.ap).startsWith('sim');
    const unsupported = String(d.ap).startsWith('não (');
    const extra = active(d) ? ' Esta placa está conectada: ativar o hotspot pode derrubar a conexão.' : '';
    el.textContent = (available ? 'Driver anuncia suporte a hotspot.' : unsupported ? 'Driver não anuncia suporte a hotspot.' : 'Ainda não foi possível verificar suporte a hotspot.') + ' Uso simultâneo Wi-Fi + hotspot não confirmado.' + extra;
    el.className = 'capability ' + (available ? 'good' : 'caution');
  }
  function renderShare() {
    const r = defaultRoute();
    $('shareInterface').textContent = r.iface || 'Não identificada';
    $('shareGateway').textContent = r.via || 'Não identificado';
    $('shareSource').textContent = r.iface || 'Sem saída conhecida';
    $('statusRoute').textContent = r.iface ? `${r.iface}${r.via ? ' · ' + r.via : ''}` : (r.raw || 'Não identificada');
  }
  function ipCell(label, lines) {
    const values = Array.isArray(lines) ? lines : [lines];
    return `<div class="ip-item"><small>${esc(label)}</small>${values.filter(Boolean).length ? values.filter(Boolean).map(v => `<strong>${esc(v)}</strong>`).join('<p></p>') : '<strong>Não configurado</strong>'}</div>`;
  }
  let ipProfile = null;
  let ipPolling = null;
  function trimProfileValue(value) { return String(value || '').trim(); }
  function updateIpFormModes() {
    const mode=$('ipMode').value, ipv6=$('ip6Mode').value;
    $('ipAddressWrap').hidden = mode === 'auto';
    $('ipGatewayWrap').hidden = mode !== 'manual';
    $('ipDnsWrap').hidden = mode === 'shared';
    $('ip6AddressWrap').hidden = ipv6 !== 'manual';
    $('ip6GatewayWrap').hidden = ipv6 !== 'manual';
    $('ip6DnsWrap').hidden = !['manual','auto'].includes(ipv6);
  }
  function setIpForm(data) {
    ipProfile = data;
    const settings=data.settings || {};
    $('ipForm').hidden=false;
    $('ipProfileTitle').textContent=`${data.connection || 'Conexão'} · ${data.device}${data.hotspot ? ' · Hotspot' : ''}`;
    const mode = data.hotspot ? 'shared' : (settings['ipv4.method']==='manual'?'manual':'auto');
    $('ipMode').innerHTML = data.hotspot ? '<option value="shared">Compartilhado (hotspot)</option>' : '<option value="auto">Automático (DHCP)</option><option value="manual">IP estático</option>';
    $('ipMode').value=mode;
    $('ipAddress').value=trimProfileValue(settings['ipv4.addresses']).split(',')[0] || '';
    $('ipGateway').value=trimProfileValue(settings['ipv4.gateway']);
    $('ipDns').value=trimProfileValue(settings['ipv4.dns']).replace(/\n/g,', ');
    $('ip6Mode').innerHTML=data.hotspot ? '<option value="unchanged">Manter IPv6 do hotspot</option>' : '<option value="unchanged">Manter configuração atual</option><option value="auto">Automático</option><option value="manual">Estático</option><option value="disabled">Desativado</option>';
    $('ip6Mode').value='unchanged';
    $('ip6Address').value=trimProfileValue(settings['ipv6.addresses']).split(',')[0] || '';
    $('ip6Gateway').value=trimProfileValue(settings['ipv6.gateway']);
    $('ip6Dns').value=trimProfileValue(settings['ipv6.dns']).replace(/\n/g,', ');
    updateIpFormModes();
    const span=$('ipInfoNote').querySelector('span');
    span.textContent=data.hotspot ? 'Este perfil é um hotspot: o IPv4 permanece compartilhado. Escolha o endereço da rede do hotspot (ex.: 10.42.0.1/24). Os clientes podem desconectar. Você terá 150 segundos para confirmar.' : 'DHCP ou IP estático será aplicado ao perfil ativo desta placa. Sua conexão pode cair. Você terá 150 segundos para confirmar o acesso; caso contrário, o sistema tenta restaurar a configuração anterior.';
  }
  async function loadIp() {
    const device = $('ipDevice').value;
    if (!device) { $('ipDetails').innerHTML = '<div class="empty">Nenhuma placa de rede encontrada.</div>'; $('ipForm').hidden=true; return; }
    $('ipDetails').innerHTML = '<div class="loading">Consultando endereços IP...</div>';
    try {
      const [details,profile] = await Promise.all([api('ip?device=' + encodeURIComponent(device)),api('ip/config?device='+encodeURIComponent(device))]);
      if ($('ipDevice').value !== device) return;
      $('ipDetails').innerHTML = ipCell('ENDEREÇO IPv4',details.ipv4)+ipCell('GATEWAY IPv4',details.gateway)+ipCell('SERVIDORES DNS',details.dns)+ipCell('ENDEREÇO IPv6',details.ipv6)+ipCell('GATEWAY IPv6',details.gateway6);
      setIpForm(profile);
      await checkIpPending();
    } catch(e) { $('ipDetails').innerHTML = `<div class="empty">Não foi possível consultar/configurar esta placa: ${esc(e.message)}</div>`; $('ipForm').hidden=true; }
  }
  async function checkIpPending(){
    try {
      const info=await api('ip/pending');
      const active=['applying','await_confirmation'].includes(info.status);
      $('ipPending').hidden=!active;
      $('ipApplyBtn').disabled=active;
      $('ipConfirmBtn').disabled=info.status!=='await_confirmation';
      if(active) {
        const left=info.expires?Math.max(0,Math.ceil(info.expires-Date.now()/1000)):null;
        $('ipPendingTitle').textContent=info.status==='applying'?'Aplicando a configuração de IP...':`Confirme a conexão${left!==null?` (${left}s restantes)`:''}`;
        $('ipPendingMessage').textContent=(info.message||'') + ' Se o IP mudou, abra o painel no novo endereço, faça login e confirme.';
        state.ipPendingId=info.id;
        if(!ipPolling) ipPolling=setInterval(checkIpPending,2000);
      }else {
        if(ipPolling) {clearInterval(ipPolling); ipPolling=null;}
        if(['rolled_back','rollback_error','error'].includes(info.status) && state.lastIpStatus!==info.status) toast(info.message||'A configuração IP não foi concluída.','error');
        state.lastIpStatus=info.status;
      }
    }catch(e){ /* O IP pode ter mudado: manter orientação de reconexão em tela. */ }
  }
  async function applyIpChange(e) {
    e.preventDefault();
    if(!ipProfile) return toast('Selecione uma conexão ativa.','warn');
    const data={device:ipProfile.device,mode:$('ipMode').value,address:$('ipAddress').value.trim(),gateway:$('ipGateway').value.trim(),dns:$('ipDns').value.trim(),
      ipv6Mode:$('ip6Mode').value,ipv6Address:$('ip6Address').value.trim(),ipv6Gateway:$('ip6Gateway').value.trim(),ipv6Dns:$('ip6Dns').value.trim()};
    if((data.mode==='manual'||data.mode==='shared')&&!data.address) return toast('Informe endereço IPv4 com prefixo. Exemplo: 192.168.1.50/24.','warn');
    if(data.ipv6Mode==='manual'&&!data.ipv6Address) return toast('Informe o endereço IPv6 com prefixo.','warn');
    if(!await panelConfirm(`Aplicar IPv4 ${data.mode==='auto'?'automático (DHCP)':data.mode==='shared'?'compartilhado para hotspot':'estático'} em ${data.device}?\nA comunicação com o servidor pode cair. Sem confirmação em 150 segundos o aplicativo tentará restaurar o perfil anterior.`, 'ip/apply')) return;
    try {
      const info=await api('ip/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
      state.ipPendingId=info.id;
      toast('Alteração iniciada. Confirme o acesso antes do prazo.','warn');
      await checkIpPending();
    }catch(error){toast(error.message,'error');}
  }
  async function confirmIpChange(){
    if(!state.ipPendingId) return;
    try{const result=await api('ip/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:state.ipPendingId})});toast(result.result||'IP confirmado.');await checkIpPending();await loadIp();}
    catch(error){toast(error.message,'error');}
  }
  function renderStatus() {
    const health = state.health;
    const failed = !!state.errors.health;
    const nmstate = health?.networkManagerState || '';
    const label = failed ? 'Serviço indisponível' : nmstate ? 'NetworkManager respondendo' : 'Sem informações';
    $('healthDisplay').className = 'health-display' + (failed ? ' bad' : '');
    $('healthDisplay').innerHTML = `<span class="health-icon">${ico(failed ? 'alert' : 'check')}</span><div><strong>${label}</strong><small>${esc(failed ? state.errors.health : `Estado: ${nmstate || 'indeterminado'} · v0.3.12`)}</small></div>`;
    const activeConnections = state.status?.connections || [];
    $('connectionsList').innerHTML = state.errors.status ? `<div class="empty">${esc(state.errors.status)}</div>` : activeConnections.length ? activeConnections.map(item => {
      const values = splitEscaped(item);
      return `<div class="connection-line"><strong>${esc(values[0] || 'Conexão')}</strong><small>Placa: ${esc(values[1] || '—')} · ${esc(values.slice(2).join(':') || 'Tipo não informado')}</small></div>`;
    }).join('') : '<div class="empty">Nenhuma conexão ativa informada.</div>';
  }
  function splitEscaped(input) {
    const parts = []; let out = '', slash = false;
    for (const ch of String(input)) {
      if (slash) { out += ch; slash = false; }
      else if (ch === '\\') slash = true;
      else if (ch === ':') { parts.push(out); out = ''; }
      else out += ch;
    }
    parts.push(out); return parts;
  }
  async function loadHealth() {
    const calls = [api('health').then(v => { state.health = v; state.errors.health = ''; }).catch(e => { state.health = null; state.errors.health = e.message; }),api('status').then(v => { state.status = v; state.errors.status = ''; }).catch(e => { state.status = null; state.errors.status = e.message; })];
    await Promise.all(calls); renderStatus(); renderOverview();
  }
  async function loadRoute() {
    try { state.route = await api('default-route'); state.errors.route = ''; }
    catch(e) { state.route = null; state.errors.route = e.message; }
    renderShare(); renderOverview();
  }
  async function refreshAll({ silent = false } = {}) {
    $('refreshAll').disabled = true;
    try {
      await Promise.all([loadDevices(), loadRoute(), loadHealth(), loadHotspots()]);
      $('lastSync').textContent = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
      if (!silent) toast('Informações atualizadas.');
    } finally { $('refreshAll').disabled = false; }
  }
  async function writeAction(action, payload, warning, skipConfirm=false) {
    if (!state.authenticated) { showAuth('Faça login para modificar a rede.'); return false; }
    if (!skipConfirm && !await panelConfirm(warning, action)) return false;
    try {
      const result = await api(action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      await refreshAll({ silent: true });
      toast(result.result || 'Operação concluída.');
      if (action === 'connect' || action === 'disconnect') await loadWifi();
      return true;
    } catch(e) { toast('Não foi possível concluir: ' + e.message, 'error'); return false; }
  }
  async function disconnectWifiDevice(device) {
    if (!device) return toast('Escolha uma placa Wi-Fi.', 'warn');
    if (!$('wifiDialog').hidden) closeWifiDialog();
    await writeAction('disconnect',{device},'Desconectar pode interromper o acesso remoto ao ZimaOS.');
  }
  function bindEvents() {
    $('confirmCancel').addEventListener('click', () => closePanelConfirm(false));
    $('confirmClose').addEventListener('click', () => closePanelConfirm(false));
    $('confirmAccept').addEventListener('click', () => closePanelConfirm(true));
    document.addEventListener('keydown', confirmKeyboard);
    document.querySelectorAll('[data-page]').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.page)));
    document.querySelectorAll('[data-goto]').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.goto)));
    $('menuBtn').addEventListener('click', () => { $('sidebar').classList.toggle('open'); $('mobileShade').classList.toggle('visible'); });
    $('mobileShade').addEventListener('click', () => { $('sidebar').classList.remove('open'); $('mobileShade').classList.remove('visible'); });
    $('refreshAll').addEventListener('click', refreshAll);
    document.querySelectorAll('[data-refresh]').forEach(btn => btn.addEventListener('click', async () => { if (btn.dataset.refresh === 'devices') await loadDevices(); else await loadHealth(); toast('Informações atualizadas.'); }));
    $('scanBtn').addEventListener('click', loadWifi);
    $('scanDevice').addEventListener('change', loadWifi);
    $('wifiNetworks').addEventListener('click', event => {
      const disconnect = event.target.closest('[data-wifi-disconnect-index]');
      if (disconnect) {
        const n=state.networks[Number(disconnect.dataset.wifiDisconnectIndex)];
        if (n) disconnectWifiDevice(n.device);
        return;
      }
      const btn=event.target.closest('[data-network-index]');
      if (!btn) return;
      const n=state.networks[Number(btn.dataset.networkIndex)];
      if (n) openWifiDialog(n);
    });
    $('wifiCurrent').addEventListener('click',event=>{
      const btn=event.target.closest('[data-wifi-device-disconnect]');
      if(btn) disconnectWifiDevice(btn.dataset.wifiDeviceDisconnect);
    });
    $('wifiDialogClose').addEventListener('click',closeWifiDialog);
    $('wifiDialogCancel').addEventListener('click',closeWifiDialog);
    $('wifiDialogPasswordToggle').addEventListener('click',()=>{
      const input=$('wifiDialogPassword'); input.type=input.type==='password'?'text':'password';
    });
    $('wifiDialogForm').addEventListener('submit',async e=>{
      e.preventDefault();
      if(!chosenWifi) return;
      const n=chosenWifi, device=$('wifiDialogDevice').value;
      if(!device) return toast('Selecione uma placa Wi-Fi.','warn');
      if(n.inUse) return disconnectWifiDevice(n.device);
      const password=$('wifiDialogPassword').value || null;
      if(await writeAction('connect',{device,ssid:n.ssid,password},'',true)) closeWifiDialog();
    });
    document.addEventListener('keydown', e => {
      if ($('wifiDialog').hidden) return;
      if (e.key==='Escape') {e.preventDefault();closeWifiDialog();}
      if (e.key==='Tab') {
        const elements=[...$('wifiDialog').querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled])')].filter(x=>x.offsetParent!==null);
        if(elements.length){const first=elements[0],last=elements[elements.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
      }
    });
    $('refreshHotspots').addEventListener('click', loadHotspots);
    $('activeHotspots').addEventListener('click', (event) => {
      const button = event.target.closest('[data-stop-hotspot]');
      if (!button || button.disabled) return;
      const h = state.hotspots.find(item => item.uuid === button.dataset.stopHotspot);
      if (!h) return;
      writeAction('hotspot/stop', { uuid: h.uuid },
        `Parar o hotspot “${h.ssid || h.name}” na placa ${h.device}?\nIsso desconectará os dispositivos conectados a ele e poderá interromper seu acesso remoto.`);
    });
    $('hotspotDevice').addEventListener('change', updateHotspotCapability);
    $('hotspotForm').addEventListener('submit', e => {
      e.preventDefault();
      const device = $('hotspotDevice').value;
      const ssid = $('hotspotSsid').value.trim();
      const password = $('hotspotPassword').value;
      const utf8Bytes = value => new TextEncoder().encode(value).length;
      if (!device) return toast('Selecione a placa que transmitirá o hotspot.', 'warn');
      if (!ssid || utf8Bytes(ssid) > 32) return toast('O nome do hotspot deve ter entre 1 e 32 bytes.', 'warn');
      if (utf8Bytes(password) < 8 || utf8Bytes(password) > 63) return toast('A senha do hotspot deve ter entre 8 e 63 bytes.', 'warn');
      const d = state.devices.find(x => x.device === device);
      const warning = 'Ativar um hotspot pode interromper a rede atual' + (d && active(d) ? ', inclusive a conexão Wi-Fi usada neste momento' : '') + '.';
      writeAction('hotspot', { device, ssid, password }, warning);
    });
    $('ipDevice').addEventListener('change', loadIp);
    $('refreshIp').addEventListener('click', loadIp);
    $('ipMode').addEventListener('change', updateIpFormModes);
    $('ip6Mode').addEventListener('change', updateIpFormModes);
    $('ipForm').addEventListener('submit', applyIpChange);
    $('ipConfirmBtn').addEventListener('click', confirmIpChange);
    $('ipPendingRefreshBtn').addEventListener('click', checkIpPending);
    document.querySelectorAll('[data-toggle-password]').forEach(btn => btn.addEventListener('click', () => { const el = $(btn.dataset.togglePassword); el.type = el.type === 'password' ? 'text' : 'password'; }));
    $('loginForm').addEventListener('submit',async e=>{
      e.preventDefault();
      const username=$('loginUsername').value.trim(),password=$('loginPassword').value;
      if(!username||!password) return showAuth('Informe usuário e senha.');
      try{const data=await api('auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});showApp(data);}
      catch(error){showAuth(error.message);$('loginUsername').value=username;}
    });
    $('setupForm').addEventListener('submit',async e=>{
      e.preventDefault();
      const username=$('setupUsername').value.trim(),password=$('setupPassword').value,pairingCode=$('setupCode').value.trim();
      if(password!==$('setupPasswordConfirm').value) { $('authNotice').textContent='As duas senhas são diferentes.'; $('authNotice').hidden=false; return; }
      if(password.length<6) { $('authNotice').textContent='Use no mínimo 6 caracteres para a senha.'; $('authNotice').hidden=false; return; }
      try{const data=await api('auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password,pairingCode})});showApp(data);toast('Conta criada! Bem-vindo ao seu painel.');}
      catch(error){$('authNotice').textContent=error.message;$('authNotice').hidden=false;}
    });
    $('logoutBtn').addEventListener('click',async()=>{
      if(!await panelConfirm('Sair do painel neste navegador? As conexões de rede continuarão funcionando.','logout')) return;
      try{await api('auth/logout',{method:'POST'});}catch(e){toast(e.message,'error');return;}
      showAuth('Você saiu do painel.');
    });
    $('passwordForm').addEventListener('submit',async e=>{
      e.preventDefault();
      const currentPassword=$('currentPassword').value,newPassword=$('newPassword').value;
      if(newPassword!==$('confirmNewPassword').value) return toast('A confirmação da nova senha não corresponde.','warn');
      if(newPassword.length<6) return toast('A nova senha precisa ter no mínimo 6 caracteres.','warn');
      try{await api('auth/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword,newPassword})});$('passwordForm').reset();showAuth('Senha alterada. Faça login novamente.');}
      catch(error){toast(error.message,'error');}
    });
  }
  bindEvents();
  (async()=>{
    try{
      const info=await api('auth/state');
      if(info.setupRequired) return showAuth('',true);
      try{const session=await api('auth/session');showApp(session);}
      catch(e){showAuth('Informe seu usuário e senha para continuar.');}
    } catch(e) {showAuth('Não foi possível verificar o acesso: '+e.message);}
  })();
})();
